// Minimal IMAP client (RFC 3501 subset) built on node:net / node:tls.
//
// Only what the sync endpoint needs: LOGIN, SELECT INBOX and FETCH of headers
// + bodies (BODY.PEEK, so nothing is flagged as \Seen). Lines are parsed with
// basic regexes and the `{N}` literal syntax is handled at the buffer level.
// This is intentionally dependency-free and best-effort: if a server response
// shape is not understood the message is skipped, not fatal.

import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";

const CRLF = "\r\n";
const COMMAND_TIMEOUT = 15_000;
const BODY_SNIPPET_LEN = 2_000;

export interface ImapConfig {
  host: string;
  port: number;
  ssl: boolean;
  username: string;
  password: string;
}

export interface ImapMessage {
  messageId: string;
  from: string;
  subject: string;
  date: string;
  body: string;
}

export class ImapUnavailableError extends Error {
  readonly code = "IMAP_UNAVAILABLE";
  constructor(message: string) {
    super(message);
  }
}

interface CommandResult {
  ok: boolean;
  message: string;
  untagged: string[];
}

interface PendingCommand {
  resolve: (res: { ok: boolean; message: string }) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

function imapQuote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

class ImapSession {
  private sock: Socket | null = null;
  private buf = "";
  private line = "";
  private readLiteral = 0;
  private inLiteralLine = false;
  private untagged: string[] = [];
  private pending = new Map<string, PendingCommand>();
  private tag = 0;
  private readonly greeted: Promise<void>;
  private resolveGreeting!: () => void;
  private rejectGreeting!: (err: Error) => void;

  constructor(private readonly cfg: ImapConfig) {
    this.greeted = new Promise<void>((resolve, reject) => {
      this.resolveGreeting = resolve;
      this.rejectGreeting = reject;
    });
  }

  async connect(): Promise<void> {
    const { host, port, ssl } = this.cfg;
    const sock = ssl ? tlsConnect({ host, port, servername: host }) : netConnect({ host, port });
    this.sock = sock;
    sock.setEncoding("utf8");
    sock.on("data", (chunk) => this.onData(String(chunk)));
    sock.on("error", (err) => this.rejectGreeting(err));
    sock.on("close", () => {
      if (this.pending.size > 0) {
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error("imap connection closed"));
        }
        this.pending.clear();
      }
    });
    await this.greeted;
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    this.pump();
  }

  private pump(): void {
    for (;;) {
      if (this.readLiteral > 0) {
        if (this.buf.length < this.readLiteral) return;
        this.line += this.buf.slice(0, this.readLiteral);
        this.buf = this.buf.slice(this.readLiteral);
        this.readLiteral = 0;
        this.inLiteralLine = true;
        continue;
      }
      const nl = this.buf.indexOf(CRLF);
      if (nl < 0) return;
      let raw = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 2);
      const lm = /\{(\d+)\}$/.exec(raw);
      if (lm) {
        this.line = raw.slice(0, lm.index);
        this.readLiteral = Number(lm[1]);
        continue;
      }
      if (this.inLiteralLine) {
        this.line += raw;
        const full = this.line;
        this.line = "";
        this.inLiteralLine = false;
        this.handleLine(full);
        continue;
      }
      this.handleLine(raw);
    }
  }

  private handleLine(line: string): void {
    if (line === "") return;
    if (!this.greetedResolved) {
      this.greetedResolved = true;
      this.resolveGreeting();
    }
    if (line.startsWith("+")) return; // continuation request (e.g. SASL) — unused
    const m = /^([A-Z0-9]+) (OK|NO|BAD)(?: (.*))?$/.exec(line);
    if (m && this.pending.has(m[1]!)) {
      const p = this.pending.get(m[1]!)!;
      clearTimeout(p.timer);
      this.pending.delete(m[1]!);
      p.resolve({ ok: m[2] === "OK", message: m[3] ?? "" });
      return;
    }
    this.untagged.push(line);
  }

  private greetedResolved = false;

  private nextTag(): string {
    return `a${++this.tag}`;
  }

  async command(cmd: string): Promise<CommandResult> {
    const sock = this.sock;
    if (!sock) throw new Error("imap not connected");
    this.untagged = [];
    const tag = this.nextTag();
    const res = await new Promise<{ ok: boolean; message: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(tag);
        sock.destroy();
        reject(new Error(`imap command timed out: ${cmd}`));
      }, COMMAND_TIMEOUT);
      this.pending.set(tag, { resolve, reject, timer });
      sock.write(`${tag} ${cmd}${CRLF}`);
    });
    return { ok: res.ok, message: res.message, untagged: this.untagged };
  }

  close(): void {
    if (this.sock) {
      this.sock.destroy();
      this.sock = null;
    }
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("imap closed"));
    }
    this.pending.clear();
  }
}

function parseHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (m) out[m[1]!.toLowerCase()] = (m[2] ?? "").trim();
  }
  return out;
}

/** Parse `* <seq> FETCH (BODY[HEADER.FIELDS (...)] <headers>)` → seq + headers. */
function parseFetch(line: string): { seq: number; headers: Record<string, string> } | null {
  const m = /^\* (\d+) FETCH \((?:BODY\[HEADER\.FIELDS[^\]]*\] )?(.*)\)$/s.exec(line);
  if (!m) return null;
  return { seq: Number(m[1]), headers: parseHeaders(m[2] ?? "") };
}

/** Parse `* <seq> FETCH (BODY[TEXT] <body>)` → seq + body text. */
function parseBody(line: string): { seq: number; body: string } | null {
  const m = /^\* (\d+) FETCH \((?:BODY\[TEXT\] )?(.*)\)$/s.exec(line);
  if (!m) return null;
  return { seq: Number(m[1]), body: m[2] ?? "" };
}

/**
 * Connect to the IMAP server, list inbox messages and return them.
 * Throws ImapUnavailableError on any connection/auth/protocol failure so the
 * HTTP layer can answer 502 without crashing.
 */
export async function fetchInbox(cfg: ImapConfig): Promise<ImapMessage[]> {
  try {
    const session = new ImapSession(cfg);
    await session.connect();
    try {
      const login = await session.command(`LOGIN ${imapQuote(cfg.username)} ${imapQuote(cfg.password)}`);
      if (!login.ok) throw new ImapUnavailableError(`imap auth failed: ${login.message}`);
      const sel = await session.command("SELECT INBOX");
      if (!sel.ok) throw new ImapUnavailableError(`imap select failed: ${sel.message}`);
      const msgs = await fetchAll(session, cfg.host);
      await session.command("LOGOUT").catch(() => {});
      return msgs;
    } finally {
      session.close();
    }
  } catch (err) {
    if (err instanceof ImapUnavailableError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new ImapUnavailableError(`imap unavailable: ${message}`);
  }
}

async function fetchAll(session: ImapSession, host: string): Promise<ImapMessage[]> {
  const headers = await session.command("FETCH 1:* (BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE MESSAGE-ID)])");
  if (!headers.ok) throw new ImapUnavailableError(`imap fetch headers failed: ${headers.message}`);
  const bodies = await session.command("FETCH 1:* (BODY.PEEK[TEXT])");
  if (!bodies.ok) throw new ImapUnavailableError(`imap fetch bodies failed: ${bodies.message}`);

  const headerMap = new Map<number, Record<string, string>>();
  for (const line of headers.untagged) {
    const parsed = parseFetch(line);
    if (parsed) headerMap.set(parsed.seq, parsed.headers);
  }
  const bodyMap = new Map<number, string>();
  for (const line of bodies.untagged) {
    const parsed = parseBody(line);
    if (parsed) bodyMap.set(parsed.seq, parsed.body);
  }

  const out: ImapMessage[] = [];
  for (const seq of new Set([...headerMap.keys(), ...bodyMap.keys()])) {
    const h = headerMap.get(seq) ?? {};
    const rawBody = bodyMap.get(seq) ?? "";
    const body = rawBody.replace(/\r?\n{3,}/g, "\n\n").slice(0, BODY_SNIPPET_LEN);
    out.push({
      messageId: h["message-id"] ?? `${seq}@${host}`,
      from: h["from"] ?? "",
      subject: h["subject"] ?? "",
      date: h["date"] ?? "",
      body,
    });
  }
  return out;
}
