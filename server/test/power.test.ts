import fs from 'node:fs';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cecLog, powerLog } from '../src/home/services.js';
import { cecEvents, cecWaker, powerChanges } from '../src/tv/power-log.js';
import { FakeTv } from './fake-tv.js';

const cec = fs.readFileSync(new URL('./fixtures/cecmessages-wake.log', import.meta.url), 'utf8');

// Real tvpowerd lines: turned off from the Home app, woken over HDMI-CEC 3½ minutes later.
const messages = [
  '2026-10-20T04:06:04.534800Z [44015.196800860] user.info sam [] SAM NL_APP_LAUNCH_BEGIN {"app_id":"com.webos.app.masterbrand"}',
  '2026-10-20T04:06:08.031429Z [44018.693429960] user.info tvpowerd [] tvpowerd NL_POWER_STATE {"old":"Active","new":"Active Standby","PowerOffReason":"homekit"} ',
  '2026-10-20T04:06:13.566025Z [44024.228026680] user.info tvpowerd [] tvpowerd NL_POWER_STATE {"old":"Active Standby","new":"Suspend","PowerOffReason":"homekit"} ',
  '2026-10-20T04:09:37.554349Z [44028.005276280] user.info tvpowerd [] tvpowerd NL_POWER_STATE {"old":"Suspend","new":"Active","PowerOnReason":"hdmiCec"} ',
].join('\n');

describe('power-log', () => {
  it('reads power changes and their reasons from syslog', () => {
    expect(powerChanges(messages)).toEqual([
      { time: '2026-10-20T04:06:08.031429Z', from: 'Active', to: 'Active Standby', reason: 'homekit' },
      { time: '2026-10-20T04:06:13.566025Z', from: 'Active Standby', to: 'Suspend', reason: 'homekit' },
      { time: '2026-10-20T04:09:37.554349Z', from: 'Suspend', to: 'Active', reason: 'hdmiCec' },
    ]);
  });

  it('names the device that claimed the screen after the last power-on', () => {
    expect(cecWaker(cec)).toBe('Apple TV');
  });

  it('lists the notable CEC messages with their senders', () => {
    const names = new Map<number, string>();
    expect(cecEvents(cec, names)).toEqual([
      { cecTime: '2026-10-20T00:06:04.739374Z', from: 'TV', event: 'standby' },
      { cecTime: '2026-10-20T00:06:05.408893Z', from: 'Apple TV', event: 'inactive source' },
      { cecTime: '2026-10-20T00:09:48.236782Z', from: 'Apple TV', event: 'image view on' },
      { cecTime: '2026-10-20T00:09:48.236834Z', from: 'Apple TV', event: 'active source' },
    ]);
    expect(names.get(11)).toBe('PlayStation 5');
  });

  it('names nothing when no device claimed the screen', () => {
    const quiet = cec
      .split('\n')
      .filter((l) => !/RX8004|RX8F821300/.test(l))
      .join('\n');
    expect(cecWaker(quiet)).toBeUndefined();
    expect(cecWaker('')).toBeUndefined();
  });
});

describe('powerLog', () => {
  let tv: FakeTv;
  let lines: Record<string, unknown>[];
  let stop: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    tv = new FakeTv();
    tv.logs = { messages, cec };
    lines = [];
    const log = pino(
      { base: undefined, timestamp: false },
      { write: (s: string) => lines.push(JSON.parse(s) as Record<string, unknown>) },
    );
    stop = powerLog(tv, log, { delayMs: 1000, wakeDelayMs: 5000 });
  });
  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  const logged = () => lines.map(({ level: _, ...rest }) => rest);

  it('logs a power-off with its reason', async () => {
    vi.setSystemTime(new Date('2026-10-20T04:06:08.000Z'));
    tv.setPower('Active');
    tv.setPower('Active Standby');
    await vi.advanceTimersByTimeAsync(1000);
    expect(logged()).toEqual([{ from: 'Active', to: 'Active Standby', reason: 'homekit', msg: 'tv power' }]);
  });

  it('logs a wake with its reason and the device that woke the TV', async () => {
    vi.setSystemTime(new Date('2026-10-20T04:06:08.000Z'));
    tv.setPower('Active');
    tv.setPower('Active Standby');
    vi.setSystemTime(new Date('2026-10-20T04:09:34.000Z'));
    tv.setPower('Active');
    await vi.advanceTimersByTimeAsync(5000);
    expect(logged().at(-1)).toEqual({
      from: 'Suspend',
      to: 'Active',
      reason: 'hdmiCec',
      wokenBy: 'Apple TV',
      msg: 'tv power',
    });
  });

  it('says unknown when the TV logged no reason for the change', async () => {
    tv.logs = { messages: '', cec: '' };
    vi.setSystemTime(new Date('2026-10-20T04:06:08.000Z'));
    tv.setPower('Active');
    tv.setPower('Screen Off');
    await vi.advanceTimersByTimeAsync(1000);
    expect(logged()).toEqual([{ from: 'Active', to: 'Screen Off', reason: 'unknown', msg: 'tv power' }]);
  });

  it('does not log the state reported when subscribing', async () => {
    tv.setPower('Active');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(lines).toEqual([]);
  });
});

describe('cecLog', () => {
  it('logs new CEC messages as they are written, named from the existing log, once each', async () => {
    vi.useFakeTimers();
    const tv = new FakeTv();
    // The existing log has the device tables but its messages are old, so they aren't logged.
    tv.cecLog = cec;
    const lines: Record<string, unknown>[] = [];
    const log = pino(
      { base: undefined, timestamp: false },
      { write: (s: string) => lines.push(JSON.parse(s) as Record<string, unknown>) },
    );
    const stop = cecLog(tv, log, 1000);
    try {
      await vi.advanceTimersByTimeAsync(0);
      // A new message, with a line still being written after it.
      tv.cecLog += '2026-10-20T22:35:54.240965Z [CECMSG] TM128 RX8F821300\n2026-10-20T22:35:54.3';
      await vi.advanceTimersByTimeAsync(1000);
      tv.cecLog += '91857Z [CECMSG] TM21486 RXB004\n';
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);
      expect(lines.map(({ level: _, ...rest }) => rest)).toEqual([
        { cecTime: '2026-10-20T22:35:54.240965Z', from: 'Apple TV', event: 'active source', msg: 'cec' },
        { cecTime: '2026-10-20T22:35:54.391857Z', from: 'PlayStation 5', event: 'image view on', msg: 'cec' },
      ]);
    } finally {
      stop();
      vi.useRealTimers();
    }
  });
});
