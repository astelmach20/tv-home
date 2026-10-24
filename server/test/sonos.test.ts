import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { classifySource } from '../src/sonos/sonos.js';
import { deviceField, EventServer, lastChange, parseSsdp, soapFields } from '../src/sonos/upnp.js';

const avEvent = fs.readFileSync(new URL('./fixtures/sonos-avtransport-event.xml', import.meta.url), 'utf8');

/** A device that accepts GENA subscriptions and sends `body` to each new subscriber, like a Sonos player does. */
async function fakePublisher(body: string) {
  const requests: { method: string; headers: http.IncomingHttpHeaders }[] = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method ?? '', headers: req.headers });
    res.writeHead(200, { SID: 'uuid:RINCON_TEST_sub1', TIMEOUT: 'Second-90' }).end();
    const callback = /^<(.+)>$/.exec(String(req.headers.callback ?? ''))?.[1];
    if (callback) {
      void fetch(callback, { method: 'NOTIFY', headers: { SID: 'uuid:RINCON_TEST_sub1', SEQ: '0' }, body });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/MediaRenderer/AVTransport/Event`, requests, close: () => server.close() };
}

/** The callback URL needs the listening port up front, so find a free one first. */
async function freePort() {
  const probe = http.createServer();
  await new Promise<void>((resolve) => probe.listen(0, resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

describe('upnp events', () => {
  it('reads the state variables of a LastChange event', () => {
    const vars = lastChange(avEvent);
    expect(vars.TransportState).toBe('STOPPED');
    expect(vars.AVTransportURI).toBe('');
    expect(vars.NextTrackURI).toBe('');
    expect(lastChange('<e:propertyset xmlns:e="urn:schemas-upnp-org:event-1-0"/>')).toEqual({});
  });

  it('subscribes, receives the first event, renews and cancels', async () => {
    const device = await fakePublisher(avEvent);
    const server = new EventServer(await freePort());
    await server.listen();
    try {
      const received = new Promise<string>((resolve) => {
        void server.subscribe(device.url, resolve, 120).then(async (sub) => {
          expect(sub.sid).toBe('uuid:RINCON_TEST_sub1');
          expect(sub.timeoutS).toBe(90);
          await sub.renew();
          await sub.cancel();
        });
      });
      expect(lastChange(await received).TransportState).toBe('STOPPED');
      await new Promise((r) => setTimeout(r, 50));
      expect(device.requests.map((r) => r.method)).toEqual(['SUBSCRIBE', 'SUBSCRIBE', 'UNSUBSCRIBE']);
      expect(device.requests[0]?.headers.nt).toBe('upnp:event');
      expect(device.requests[0]?.headers.timeout).toBe('Second-120');
      expect(device.requests[1]?.headers.sid).toBe('uuid:RINCON_TEST_sub1');
    } finally {
      server.close();
      device.close();
    }
  });

  it('rejects notifications for unknown subscriptions', async () => {
    const port = await freePort();
    const server = new EventServer(port);
    await server.listen();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/upnp/nope`, { method: 'NOTIFY', body: avEvent });
      expect(res.status).toBe(412);
    } finally {
      server.close();
    }
  });
});

describe('classifySource', () => {
  it('tells TV audio, Spotify Connect, AirPlay and grouping apart', () => {
    expect(
      [
        'x-sonos-htastream:RINCON_XXXXXXXXXXXX01400:spdif',
        'x-sonos-vli:RINCON_XXXXXXXXXXXX01400:2,spotify:00000000000000000000000000000000',
        'x-sonos-vli:RINCON_XXXXXXXXXXXX01400:1,airplay:abc',
        'x-rincon:RINCON_YYYYYYYYYYYY01400',
        'x-rincon-stream:RINCON_YYYYYYYYYYYY01400',
        'x-sonosapi-hls:radio',
        '',
      ].map(classifySource),
    ).toEqual(['tv', 'spotify', 'airplay', 'grouped', 'line-in', 'app', 'none']);
  });
});

describe('upnp', () => {
  it('reads SSDP response headers', () => {
    const h = parseSsdp(
      'HTTP/1.1 200 OK\r\nLOCATION: http://192.0.2.10:1400/xml/device_description.xml\r\nST: urn:schemas-upnp-org:device:ZonePlayer:1\r\n\r\n',
    );
    expect(h.get('location')).toBe('http://192.0.2.10:1400/xml/device_description.xml');
    expect(h.get('st')).toBe('urn:schemas-upnp-org:device:ZonePlayer:1');
  });

  it('reads fields from a SOAP response', () => {
    const text =
      '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:GetTransportInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><CurrentTransportState>PLAYING</CurrentTransportState><CurrentSpeed>1</CurrentSpeed></u:GetTransportInfoResponse></s:Body></s:Envelope>';
    expect(soapFields(text, 'GetTransportInfo')).toEqual({ CurrentTransportState: 'PLAYING', CurrentSpeed: '1' });
  });

  it('reads the room name from a device description', () => {
    const text =
      '<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><device><roomName>Sonos Arc Ultra</roomName></device></root>';
    expect(deviceField(text, 'roomName')).toBe('Sonos Arc Ultra');
  });
});
