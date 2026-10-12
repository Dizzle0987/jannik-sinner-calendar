import { readFile } from "node:fs/promises";
import { fallbackSeason, parseIcsDate } from "./tennis-season.mjs";

const raw = await readFile(new URL("../calendar.ics", import.meta.url), "utf8");
const unfolded = raw.replace(/\r?\n[ \t]/g, "");
const events = [...unfolded.matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)END:VEVENT/g)].map(match => match[1]);
const currentSeason = Number(unfolded.match(/^X-CURRENT-TENNIS-SEASON:(\d{4})$/m)?.[1]);
if (!currentSeason) throw new Error("Stagione tennistica corrente mancante");
if (!raw.startsWith("BEGIN:VCALENDAR") || !raw.trimEnd().endsWith("END:VCALENDAR")) throw new Error("Struttura VCALENDAR non valida");
const uids = events.map(event => (event.match(/^UID:(.+)$/m) ?? [])[1]);
if (uids.some(uid => !uid) || new Set(uids).size !== uids.length) throw new Error("UID mancanti o duplicati");
for (const event of events) {
  for (const key of ["DTSTAMP", "DTSTART", "DTEND", "SUMMARY", "STATUS", "SEQUENCE", "DESCRIPTION"]) {
    if (!new RegExp(`^${key}[:;]`, "m").test(event)) throw new Error(`${key} manca in un evento`);
  }
  const start = parseIcsDate((event.match(/^DTSTART(?:;[^:]*)?:(.+)$/m) ?? [])[1]);
  const eventSeason = Number((event.match(/^X-TENNIS-SEASON:(\d{4})$/m) ?? [])[1]) || (start && fallbackSeason(start));
  if (!eventSeason || eventSeason < currentSeason) throw new Error(`Evento della stagione ${eventSeason ?? "sconosciuta"} ancora presente nel calendario ${currentSeason}`);
}
for (const line of raw.split(/\r?\n/)) {
  if (Buffer.byteLength(line, "utf8") > 75) throw new Error(`Riga iCalendar oltre 75 byte: ${line}`);
}
console.log(`Calendario valido: ${events.length} eventi, ${uids.length} UID unici.`);
