// Why the TV turned on or off, and what its HDMI devices said, read from the TV's own logs. tvpowerd writes the
// reason to /var/log/messages, and the CEC daemon writes every HDMI-CEC message to /var/log/cecmessages; neither is
// available over Luna.

export interface PowerChange {
  /** When tvpowerd logged it (ISO, UTC). */
  time: string;
  from: string;
  to: string;
  /** e.g. "homekit", "hdmiCec", "remoteKey" */
  reason: string | undefined;
}

/** Every `NL_POWER_STATE` line in a syslog text, oldest first. */
export function powerChanges(messages: string): PowerChange[] {
  const out: PowerChange[] = [];
  for (const line of messages.split('\n')) {
    const m = /^(\S+) .*NL_POWER_STATE (\{.*\})/.exec(line);
    if (!m?.[1] || !m[2]) continue;
    let fields: Record<string, unknown>;
    try {
      fields = JSON.parse(m[2]) as Record<string, unknown>;
    } catch {
      continue;
    }
    const { old, new: to, PowerOnReason, PowerOffReason } = fields;
    if (typeof old !== 'string' || typeof to !== 'string') continue;
    const reason = PowerOnReason ?? PowerOffReason;
    out.push({ time: m[1], from: old, to, reason: typeof reason === 'string' ? reason : undefined });
  }
  return out;
}

// <Image View On>, <Text View On>, <Active Source>: what a device sends to turn the TV on and put itself on screen.
const CLAIMS = new Set(['04', '0D', '82']);

/**
 * The device that claimed the screen after the TV's last power-on, from a cecmessages text: the first one to send
 * Image View On, Text View On or Active Source after the power-on. The message that actually woke the TV is handled
 * while the TV is suspended and never logged, but the device that sent it repeats its claim once the TV is up.
 */
export function cecWaker(cec: string): string | undefined {
  const lines = cec.split('\n');
  const names = cecNames(lines);
  let start = -1;
  lines.forEach((line, i) => {
    if (/\[CECMSG\] \S+ CMD L 202 00\b/.test(line)) start = i;
  });
  if (start < 0) return undefined;
  for (const line of lines.slice(start + 1)) {
    const m = /\[CECMSG\] \S+ RX([0-9A-F])[0-9A-F]([0-9A-F]{2})/i.exec(line);
    if (!m?.[1] || !m[2] || !CLAIMS.has(m[2].toUpperCase())) continue;
    const addr = parseInt(m[1], 16);
    return names.get(addr) ?? `CEC device ${addr}`;
  }
  return undefined;
}

// The CEC messages worth a log line: a device turning the TV on, taking or giving up the screen, or going to standby.
const EVENTS: Record<string, string> = {
  '04': 'image view on',
  '0D': 'text view on',
  '82': 'active source',
  '9D': 'inactive source',
  '36': 'standby',
};

export interface CecEvent {
  /** The CEC daemon's own timestamp: local time, despite the Z. */
  cecTime: string;
  /** OSD name of the sender, or "TV" for messages the TV sent. */
  from: string;
  event: string;
}

/** The notable CEC messages in a cecmessages text, oldest first. `names` is updated from any device tables in it. */
export function cecEvents(cec: string, names: Map<number, string>): CecEvent[] {
  const lines = cec.split('\n');
  for (const [addr, name] of cecNames(lines)) names.set(addr, name);
  const out: CecEvent[] = [];
  for (const line of lines) {
    const m = /^(\S+) \[CECMSG\] \S+ (RX|TX)([0-9A-F])[0-9A-F]([0-9A-F]{2})/i.exec(line);
    if (!m?.[1] || !m[3] || !m[4]) continue;
    const event = EVENTS[m[4].toUpperCase()];
    if (!event) continue;
    const addr = parseInt(m[3], 16);
    const from = m[2] === 'TX' ? 'TV' : (names.get(addr) ?? `CEC device ${addr}`);
    out.push({ cecTime: m[1], from, event });
  }
  return out;
}

/** Logical address -> OSD name, from the device tables the CEC daemon dumps every few minutes (latest wins). */
function cecNames(lines: string[]): Map<number, string> {
  const names = new Map<number, string>();
  let addr: number | undefined;
  for (const line of lines) {
    const laddr = /LADDR:0x([0-9A-F]+)/i.exec(line);
    if (laddr?.[1]) {
      addr = parseInt(laddr[1], 16);
      continue;
    }
    const osd = /OSD\(([^)]*)\)/.exec(line);
    if (osd?.[1] && addr !== undefined) {
      names.set(addr, osd[1]);
      addr = undefined;
    }
  }
  return names;
}
