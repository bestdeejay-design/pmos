// Lightweight RFC 5545 (iCalendar) VEVENT parser for ICS feeds.
// Unfolds continuation lines, extracts VEVENT blocks and the fields the
// external-calendars service stores. Best-effort: unknown properties and
// malformed blocks are skipped, never fatal.

export interface IcsEvent {
  uid: string;
  summary: string;
  description: string | null;
  startTime: string;
  endTime: string | null;
  location: string | null;
  recurrenceRule: string | null;
}

function unescapeText(s: string): string {
  return s.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

// Convert an iCalendar date-time (e.g. 20260801T090000Z, 20260801T090000,
// 20260801) into an ISO-ish string matching the rest of the platform
// (millisecond precision, Z for UTC). Non-parseable values pass through as-is.
function toIsoDate(raw: string): string {
  const v = raw.trim();
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (dt) {
    const [, y, mo, d, h, mi, s, z] = dt;
    return `${y}-${mo}-${d}T${h}:${mi}:${s}.000${z ? "Z" : ""}`;
  }
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (date) {
    const [, y, mo, d] = date;
    return `${y}-${mo}-${d}T00:00:00.000Z`;
  }
  return v;
}

export function parseIcs(raw: string): IcsEvent[] {
  const unfolded = raw.replace(/\r\n[ \t]/g, "").split(/\r\n|\n/);
  const events: IcsEvent[] = [];
  let cur: Record<string, string> | null = null;

  for (const line of unfolded) {
    if (line === "BEGIN:VEVENT") {
      cur = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur) {
        const ev = toIcsEvent(cur);
        if (ev) events.push(ev);
        cur = null;
      }
      continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const name = line.slice(0, idx).split(";")[0]!.toUpperCase();
    const value = line.slice(idx + 1);
    if (!(name in cur)) cur[name] = value;
  }

  return events;
}

function toIcsEvent(fields: Record<string, string>): IcsEvent | null {
  const summary = fields["SUMMARY"] ? unescapeText(fields["SUMMARY"]) : "Untitled event";
  const startTime = fields["DTSTART"] ? toIsoDate(fields["DTSTART"]) : "";
  if (!startTime) return null;
  return {
    uid: fields["UID"] || `${summary}:${startTime}`,
    summary,
    description: fields["DESCRIPTION"] ? unescapeText(fields["DESCRIPTION"]) : null,
    startTime,
    endTime: fields["DTEND"] ? toIsoDate(fields["DTEND"]) : null,
    location: fields["LOCATION"] ? unescapeText(fields["LOCATION"]) : null,
    recurrenceRule: fields["RRULE"] ? fields["RRULE"].trim() : null,
  };
}
