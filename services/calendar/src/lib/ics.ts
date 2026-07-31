// RFC 5545 (iCalendar) VEVENT generation for calendar meetings.
// Time handling: the database stores timestamps as ISO strings (mode: "string",
// timestamptz), so values arrive already timezone-qualified (e.g. "2026-08-01T09:00:00Z").
// We emit them in UTC "basic" form (YYYYMMDDTHHMMSSZ) which is the canonical iCalendar
// representation for UTC instants. Non-Z (floating/zoned) values are preserved as-is.

export interface IcsMeeting {
  id: string;
  title: string;
  startTime: string; // ISO
  endTime: string; // ISO
  allDay?: boolean;
  description?: string | null;
  location?: string | null;
  recurrence?: string | null; // RFC5545 RRULE string, e.g. "RRULE:FREQ=DAILY"
  createdAt?: string | null;
  updatedAt?: string | null;
}

/** Escape special characters in TEXT values (RFC 5545 §3.3.11). */
function escText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** Convert an ISO timestamp to iCalendar UTC/UTC-basic form. */
function toIcsDateTime(iso: string): string {
  if (!iso) return "";
  // Already has a Z (UTC) or an explicit offset → normalise to Z.
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso; // best-effort: leave as provided
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Fold long lines per RFC 5545 §3.1 (75 octets, CRLF + space continuation). */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const out: string[] = [];
  let cur = line;
  out.push(cur.slice(0, 75));
  cur = " " + cur.slice(75);
  while (cur.length > 75) {
    out.push(cur.slice(0, 75));
    cur = " " + cur.slice(75);
  }
  out.push(cur);
  return out.join("\r\n");
}

function stamp(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d.getTime())) return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function toIcs(meeting: IcsMeeting): string {
  const uid = `${meeting.id}@pmos.local`;
  const dtstamp = stamp(meeting.updatedAt ?? meeting.createdAt);
  const dtstart = toIcsDateTime(meeting.startTime);
  const dtend = toIcsDateTime(meeting.endTime);

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PMOS//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    meeting.allDay ? `DTSTART;VALUE=DATE:${dtstart.slice(0, 8)}` : `DTSTART:${dtstart}`,
    meeting.allDay ? `DTEND;VALUE=DATE:${dtend.slice(0, 8)}` : `DTEND:${dtend}`,
    `SUMMARY:${escText(meeting.title)}`,
  ];

  if (meeting.description) lines.push(`DESCRIPTION:${escText(meeting.description)}`);
  if (meeting.location) lines.push(`LOCATION:${escText(meeting.location)}`);
  if (meeting.recurrence) {
    // Stored as "RRULE:FREQ=DAILY"; emit only the "RRULE:FREQ=..." part.
    const rrule = meeting.recurrence.startsWith("RRULE:") ? meeting.recurrence.slice(6) : meeting.recurrence;
    lines.push(`RRULE:${rrule}`);
  }
  lines.push("END:VEVENT", "END:VCALENDAR");

  // Fold every line that exceeds 75 octets, terminate with CRLF.
  return lines.map(fold).join("\r\n") + "\r\n";
}
