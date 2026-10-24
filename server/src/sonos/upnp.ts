// Just enough UPnP to talk to Sonos players on the LAN: SSDP discovery, SOAP actions and GENA event subscriptions.
import { randomUUID } from 'node:crypto';
import dgram from 'node:dgram';
import http from 'node:http';
import { XMLParser } from 'fast-xml-parser';

const SSDP = { address: '239.255.255.250', port: 1900 };
export const ZONE_PLAYER = 'urn:schemas-upnp-org:device:ZonePlayer:1';

/** Parse an SSDP response's headers (case-insensitive names, lowercased). */
export function parseSsdp(message: string): Map<string, string> {
  const headers = new Map<string, string>();
  for (const line of message.split('\r\n').slice(1)) {
    const i = line.indexOf(':');
    if (i > 0) headers.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
  }
  return headers;
}

/** Base URLs (`http://ip:1400`) of devices answering an M-SEARCH for `target` within `timeoutMs`. */
export function discover(target: string, timeoutMs = 2000): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const found = new Set<string>();
    socket.on('message', (msg) => {
      const headers = parseSsdp(msg.toString('utf8'));
      const location = headers.get('location');
      if (headers.get('st') !== target || !location) return;
      try {
        found.add(new URL(location).origin);
      } catch {
        // Not a URL; ignore the response.
      }
    });
    socket.on('error', (err) => {
      socket.close();
      reject(err);
    });
    socket.bind(() => {
      const search = [
        'M-SEARCH * HTTP/1.1',
        `HOST: ${SSDP.address}:${SSDP.port}`,
        'MAN: "ssdp:discover"',
        'MX: 1',
        `ST: ${target}`,
        '',
        '',
      ].join('\r\n');
      socket.send(search, SSDP.port, SSDP.address);
      setTimeout(() => {
        socket.close();
        resolve([...found]);
      }, timeoutMs);
    });
  });
}

const xml = new XMLParser({ removeNSPrefix: true, parseTagValue: false });

/** Call a SOAP action and return the response element's fields as strings. */
export async function soap(
  baseUrl: string,
  controlPath: string,
  service: string,
  action: string,
  args: Record<string, string | number> = {},
  timeoutMs = 4000,
): Promise<Record<string, string>> {
  const body = Object.entries(args)
    .map(([k, v]) => `<${k}>${String(v)}</${k}>`)
    .join('');
  const res = await fetch(baseUrl + controlPath, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPACTION: `"${service}#${action}"` },
    body:
      '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
      `<s:Body><u:${action} xmlns:u="${service}">${body}</u:${action}></s:Body></s:Envelope>`,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${action} failed: HTTP ${res.status}`);
  return soapFields(await res.text(), action);
}

/** The text fields of `<actionResponse>` in a SOAP envelope. */
export function soapFields(text: string, action: string): Record<string, string> {
  const doc: unknown = xml.parse(text);
  const response = dig(doc, ['Envelope', 'Body', `${action}Response`]);
  const out: Record<string, string> = {};
  if (response && typeof response === 'object') {
    for (const [k, v] of Object.entries(response)) if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/** A text field from a device description XML (e.g. `roomName`). */
export function deviceField(text: string, field: string): string | undefined {
  const value = dig(xml.parse(text), ['root', 'device', field]);
  return typeof value === 'string' ? value : undefined;
}

const withAttributes = new XMLParser({
  removeNSPrefix: true,
  parseTagValue: false,
  ignoreAttributes: false,
  attributeNamePrefix: '',
});

/**
 * The state variables in a GENA event's `LastChange` property (AVTransport, RenderingControl), as name -> `val`.
 * The first event of a subscription carries every variable; later ones only what changed.
 */
export function lastChange(body: string): Record<string, string> {
  const properties = dig(xml.parse(body), ['propertyset', 'property']);
  const change = [properties]
    .flat()
    .map((p) => dig(p, ['LastChange']))
    .find((v) => typeof v === 'string');
  if (typeof change !== 'string') return {};
  const instance = dig(withAttributes.parse(change), ['Event', 'InstanceID']);
  const out: Record<string, string> = {};
  if (instance && typeof instance === 'object') {
    for (const [k, v] of Object.entries(instance)) {
      const val = dig(v, ['val']);
      if (typeof val === 'string') out[k] = val;
    }
  }
  return out;
}

/** The local address this host uses to reach `host`, i.e. the one to give it as a callback. */
export function localAddressFor(host: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    socket.on('error', (err) => {
      socket.close();
      reject(err);
    });
    socket.connect(SSDP.port, host, () => {
      const { address } = socket.address();
      socket.close();
      resolve(address);
    });
  });
}

const MAX_EVENT_BYTES = 1 << 20;

/** A GENA subscription to one service's events. Renew it before `timeoutS` runs out or the device drops it. */
export interface Subscription {
  readonly sid: string;
  readonly timeoutS: number;
  renew(): Promise<void>;
  cancel(): Promise<void>;
}

/**
 * Receives GENA NOTIFY callbacks. Each subscription gets its own callback path, so the first event (which can arrive
 * before the SUBSCRIBE response) is routed without knowing its SID yet.
 */
export class EventServer {
  private readonly routes = new Map<string, (body: string) => void>();
  private server: http.Server | undefined;

  constructor(private readonly port: number) {}

  listen(): Promise<void> {
    const server = http.createServer((req, res) => this.handle(req, res));
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, '0.0.0.0', () => resolve());
    });
  }

  close() {
    this.server?.close();
    this.routes.clear();
  }

  /** Subscribe to `eventUrl` (e.g. `http://ip:1400/MediaRenderer/AVTransport/Event`); `onEvent` gets each NOTIFY body. */
  async subscribe(eventUrl: string, onEvent: (body: string) => void, timeoutS: number): Promise<Subscription> {
    const { hostname } = new URL(eventUrl);
    const path = `/upnp/${randomUUID()}`;
    const callback = `http://${await localAddressFor(hostname)}:${this.port}${path}`;
    this.routes.set(path, onEvent);
    try {
      const first = await gena(eventUrl, 'SUBSCRIBE', { CALLBACK: `<${callback}>`, NT: 'upnp:event' }, timeoutS);
      let sid = first.sid;
      let timeout = first.timeoutS;
      return {
        get sid() {
          return sid;
        },
        get timeoutS() {
          return timeout;
        },
        renew: async () => {
          ({ sid, timeoutS: timeout } = await gena(eventUrl, 'SUBSCRIBE', { SID: sid }, timeoutS));
        },
        cancel: async () => {
          this.routes.delete(path);
          await gena(eventUrl, 'UNSUBSCRIBE', { SID: sid }).catch(() => undefined);
        },
      };
    } catch (err) {
      this.routes.delete(path);
      throw err;
    }
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const onEvent = req.method === 'NOTIFY' ? this.routes.get(req.url ?? '') : undefined;
    if (!onEvent) {
      req.resume();
      res.writeHead(412).end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_EVENT_BYTES) req.destroy();
      else chunks.push(chunk);
    });
    req.on('end', () => {
      res.writeHead(200).end();
      onEvent(Buffer.concat(chunks).toString('utf8'));
    });
  }
}

async function gena(
  url: string,
  method: 'SUBSCRIBE' | 'UNSUBSCRIBE',
  headers: Record<string, string>,
  timeoutS?: number,
): Promise<{ sid: string; timeoutS: number }> {
  const res = await fetch(url, {
    method,
    headers: timeoutS ? { ...headers, TIMEOUT: `Second-${timeoutS}` } : headers,
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`${method} ${url} failed: HTTP ${res.status}`);
  const sid = res.headers.get('sid') ?? headers.SID ?? '';
  const granted = Number(/^Second-(\d+)$/i.exec(res.headers.get('timeout') ?? '')?.[1]);
  return { sid, timeoutS: granted || timeoutS || 0 };
}

function dig(value: unknown, keys: string[]): unknown {
  let cur = value;
  for (const key of keys) {
    if (!cur || typeof cur !== 'object' || !(key in cur)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}
