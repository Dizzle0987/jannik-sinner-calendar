import { readFile } from "node:fs/promises";

const raw = await readFile(new URL("../calendar.ics", import.meta.url), "utf8");
const unfolded = raw.replace(/\r?\n[ \t]/g, "");
const events = [...unfolded.matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)END:VEVENT/g)].map(match => match[1]);
if (!raw.startsWith("BEGIN:VCALENDAR") || !raw.trimEnd().endsWith("END:VCALENDAR")) throw new Error("Struttura VCALENDAR non valida");
const uids = events.map(event => (event.match(/^UID:(.+)$/m) ?? [])[1]);
if (uids.some(uid => !uid) || new Set(uids).size !== uids.length) throw new Error("UID mancanti o duplicati");
for (const event of events) {
  for (const key of ["DTSTAMP", "DTSTART", "DTEND", "SUMMARY", "STATUS", "SEQUENCE", "DESCRIPTION"]) {
    if (!new RegExp(`^${key}[:;]`, "m").test(event)) throw new Error(`${key} manca in un evento`);
  }
}
for (const line of raw.split(/\r?\n/)) {
  if (Buffer.byteLength(line, "utf8") > 75) throw new Error(`Riga iCalendar oltre 75 byte: ${line}`);
}
console.log(`Calendario valido: ${events.length} eventi, ${uids.length} UID unici.`);
