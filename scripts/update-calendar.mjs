import { readFile, writeFile } from "node:fs/promises";
import { fallbackSeason, parseIcsDate, TIME_ZONE } from "./tennis-season.mjs";

const ROOT = new URL("../", import.meta.url);
const CALENDAR_PATH = new URL("calendar.ics", ROOT);
const PAGE_PATH = new URL("index.html", ROOT);
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/tennis";

const PLAYERS = new Map([
  ["Jannik Sinner", "atp"],
  ["Flavio Cobolli", "atp"],
  ["Lorenzo Musetti", "atp"],
  ["Luciano Darderi", "atp"],
  ["Matteo Arnaldi", "atp"],
  ["Matteo Berrettini", "atp"],
  ["Jasmine Paolini", "wta"],
  ["Elisabetta Cocciaretto", "wta"],
  ["Lucia Bronzetti", "wta"],
]);

const pad = value => String(value).padStart(2, "0");
const compactUtc = date => `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
const apiDate = date => `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
const localDate = date => new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const icsDate = value => value.replaceAll("-", "");
const addDays = (date, amount) => new Date(date.getTime() + amount * 86400000);
const addHours = (date, amount) => new Date(date.getTime() + amount * 3600000);

function escapeText(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}

function foldLine(line) {
  const chunks = [];
  let current = "";
  let limit = 75;
  for (const char of line) {
    if (Buffer.byteLength(current + char, "utf8") > limit) {
      const endsWithSpace = current.endsWith(" ");
      chunks.push(endsWithSpace ? current.slice(0, -1) : current);
      current = `${endsWithSpace ? " " : ""}${char}`;
      limit = 74;
    } else {
      current += char;
    }
  }
  chunks.push(current);
  return chunks.map((chunk, index) => index ? ` ${chunk}` : chunk).join("\n");
}

const unfold = value => value.replace(/\r?\n[ \t]/g, "");
const field = (block, name) => (unfold(block).match(new RegExp(`^${name}(?:;[^:]*)?:(.*)$`, "m")) ?? [])[1] ?? "";
const canonical = block => unfold(block).replace(/^DTSTAMP:.*\n/m, "").replace(/^SEQUENCE:.*\n/m, "").trim();
const normalized = value => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

function scoreFor(italian, opponent) {
  const italianSets = italian.linescores ?? [];
  const opponentSets = opponent.linescores ?? [];
  return italianSets.map((set, index) => {
    const other = opponentSets[index];
    if (!other) return null;
    const italianValue = Number(set.value);
    const opponentValue = Number(other.value);
    let score = `${italianValue}-${opponentValue}`;
    if (italianValue === 7 && opponentValue === 6 && other.tiebreak != null) score += `(${Number(other.tiebreak)})`;
    if (italianValue === 6 && opponentValue === 7 && set.tiebreak != null) score += `(${Number(set.tiebreak)})`;
    return score;
  }).filter(Boolean).join(" ");
}

function television(league) {
  if (league === "wta") {
    return [
      "TV Italia: controllare SuperTennis HD e SuperTennis Plus",
      "TV Austria: controllare ORF, ServusTV e guide TV aggregate",
    ];
  }
  return [
    "TV Italia: controllare Sky Sport e NOW",
    "TV Austria: controllare ORF, ServusTV e guide TV aggregate",
  ];
}

function recordFromCompetition(tournament, grouping, competition, league) {
  if (!String(grouping?.grouping?.slug ?? competition?.type?.slug).includes("singles")) return null;
  const competitors = (competition.competitors ?? []).filter(item => item.athlete?.displayName);
  if (competitors.length !== 2 || competitors.some(item => item.athlete.displayName === "TBD")) return null;
  const italian = competitors.find(item => PLAYERS.get(item.athlete.displayName) === league);
  if (!italian) return null;
  const opponent = competitors.find(item => item !== italian);
  const start = new Date(competition.date ?? competition.startDate);
  if (Number.isNaN(start.getTime())) return null;
  const state = competition.status?.type?.state ?? "pre";
  const completed = competition.status?.type?.completed === true || state === "post";
  const inProgress = state === "in";
  const winner = completed ? italian.winner === true : null;
  const score = completed || inProgress ? scoreFor(italian, opponent) : "";
  const round = competition.round?.displayName ?? "Turno da confermare";
  const venueParts = [competition.venue?.fullName ?? tournament.venue?.displayName, competition.venue?.court].filter(Boolean);
  const tournamentUrl = (tournament.links ?? []).find(link => link.rel?.includes("summary"))?.href ?? "https://www.espn.com/tennis/scoreboard";
  return {
    id: String(competition.id),
    uid: `espn-${competition.id}@italian-tennis-calendar`,
    league,
    tournament: tournament.name,
    round,
    start,
    date: localDate(start),
    timeValid: competition.timeValid === true,
    state,
    completed,
    inProgress,
    statusDetail: competition.status?.type?.detail ?? "",
    winner,
    score,
    italian: italian.athlete.displayName,
    opponent: opponent.athlete.displayName,
    location: venueParts.join(", "),
    url: tournamentUrl,
    season: Number(tournament.season?.year) || fallbackSeason(start),
  };
}

async function fetchScoreboards(now) {
  const offsets = [-2, 0, 2, 5, 8];
  const requests = [];
  for (const league of ["atp", "wta"]) {
    for (const offset of offsets) {
      const date = apiDate(addDays(now, offset));
      const url = `${ESPN}/${league}/scoreboard?dates=${date}`;
      requests.push(fetch(url, { headers: { "User-Agent": "Italian-Tennis-Calendar/1.0" } })
        .then(response => {
          if (!response.ok) throw new Error(`${response.status} ${url}`);
          return response.json();
        })
        .then(data => ({ league, events: data.events ?? [] })));
    }
  }
  const settled = await Promise.allSettled(requests);
  const successful = settled.filter(result => result.status === "fulfilled").map(result => result.value);
  if (!successful.length) throw new Error("Nessuna risposta valida ricevuta dai tabelloni ESPN");

  const records = new Map();
  const activeSeasons = new Set();
  for (const response of successful) {
    for (const tournament of response.events) {
      const tournamentStart = new Date(tournament.date);
      const tournamentEnd = new Date(tournament.endDate);
      const officialSeason = Number(tournament.season?.year);
      if (officialSeason && tournamentStart <= now && now <= tournamentEnd) activeSeasons.add(officialSeason);
      for (const grouping of tournament.groupings ?? []) {
        for (const competition of grouping.competitions ?? []) {
          const record = recordFromCompetition(tournament, grouping, competition, response.league);
          if (!record) continue;
          const distance = record.start.getTime() - now.getTime();
          if (distance < -21 * 86400000 || distance > 21 * 86400000) continue;
          records.set(record.id, record);
        }
      }
    }
  }
  return {
    records: [...records.values()].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id)),
    activeSeasons: [...activeSeasons],
  };
}

function buildEvent(record, { uid, stamp, sequence }) {
  const description = [
    `${record.tournament} - ${record.round}`,
    record.completed
      ? `Conclusa: ${record.winner ? "vittoria" : "sconfitta"} ${record.italian}${record.score ? ` ${record.score}` : ""}`
      : record.inProgress
        ? `In corso${record.score ? `: ${record.score}` : ""}`
        : record.timeValid ? "In programma" : "In programma; orario da confermare",
    "Superficie e programma soggetti agli aggiornamenti del torneo",
    ...television(record.league),
    "Dati partita: ESPN; verificare le fonti ufficiali del torneo",
  ].join("\n");
  const lines = [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
  ];
  if (record.timeValid) {
    lines.push(`DTSTART:${compactUtc(record.start)}`);
    lines.push(`DTEND:${compactUtc(addHours(record.start, 3))}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${icsDate(record.date)}`);
    lines.push(`DTEND;VALUE=DATE:${icsDate(localDate(addDays(record.start, 1)))}`);
  }
  lines.push(
    `SUMMARY:${escapeText(`${record.italian} vs ${record.opponent}`)}`,
    `LOCATION:${escapeText(record.location || record.tournament)}`,
    `STATUS:${record.completed || record.inProgress || record.timeValid ? "CONFIRMED" : "TENTATIVE"}`,
    `SEQUENCE:${sequence}`,
    "TRANSP:TRANSPARENT",
    `CATEGORIES:${escapeText(`${record.tournament},${record.league.toUpperCase()}`)}`,
    `X-TENNIS-SEASON:${record.season}`,
    `DESCRIPTION:${escapeText(description)}`,
    `URL:${record.url}`,
  );
  if (!record.completed && !record.inProgress && record.timeValid) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "TRIGGER:-PT2H",
      `DESCRIPTION:${escapeText(`Tra due ore: ${record.italian} vs ${record.opponent}`)}`,
      "END:VALARM",
    );
  }
  lines.push("END:VEVENT");
  return lines.map(foldLine).join("\n");
}

function matchesRecord(block, record) {
  const summary = normalized(field(block, "SUMMARY"));
  const date = field(block, "DTSTART").slice(0, 8);
  const containsName = name => normalized(name).split(/\s+/).filter(part => part.length > 1).every(part => summary.includes(part));
  return date === icsDate(record.date)
    && containsName(record.italian)
    && containsName(record.opponent);
}

function updateCalendar(raw, records, now, currentSeason) {
  const blocks = [...raw.matchAll(/BEGIN:VEVENT\r?\n[\s\S]*?END:VEVENT/g)]
    .map(match => match[0])
    .filter(block => {
      const start = parseIcsDate(field(block, "DTSTART"));
      const eventSeason = Number(field(block, "X-TENNIS-SEASON")) || (start && fallbackSeason(start));
      return eventSeason && eventSeason >= currentSeason;
    });
  let header = raw.slice(0, raw.indexOf("BEGIN:VEVENT"));
  if (/^X-CURRENT-TENNIS-SEASON:/m.test(header)) {
    header = header.replace(/^X-CURRENT-TENNIS-SEASON:.*$/m, `X-CURRENT-TENNIS-SEASON:${currentSeason}`);
  } else {
    header = `${header.trimEnd()}\nX-CURRENT-TENNIS-SEASON:${currentSeason}\n`;
  }
  const byUid = new Map(blocks.map(block => [field(block, "UID"), block]));
  const replacements = new Map();
  const removals = new Set();
  const stamp = compactUtc(now);

  for (const record of records) {
    const matching = blocks.filter(block => matchesRecord(block, record));
    let old = matching.find(block => !field(block, "UID").startsWith("espn-"))
      ?? byUid.get(record.uid)
      ?? matching[0];
    for (const duplicate of matching) if (duplicate !== old) removals.add(duplicate);
    const uid = old ? field(old, "UID") : record.uid;
    const previousSequence = old ? Number(field(old, "SEQUENCE") || 0) : -1;
    let candidate = buildEvent(record, { uid, stamp, sequence: Math.max(0, previousSequence + 1) });
    const formattingOkay = old && old.split(/\r?\n/).every(line => Buffer.byteLength(line, "utf8") <= 75 && !/[ \t]$/.test(line));
    if (old && canonical(old) === canonical(candidate) && formattingOkay) candidate = old;
    if (old) replacements.set(old, candidate);
    else blocks.push(candidate);
  }

  const updated = blocks.filter(block => !removals.has(block)).map(block => replacements.get(block) ?? block);
  updated.sort((a, b) => field(a, "DTSTART").localeCompare(field(b, "DTSTART")) || field(a, "UID").localeCompare(field(b, "UID")));
  return `${header}${updated.join("\n")}\nEND:VCALENDAR\n`;
}

function italianDate(date) {
  return new Intl.DateTimeFormat("it-IT", { timeZone: TIME_ZONE, day: "numeric", month: "long", year: "numeric" }).format(date);
}

function italianDateTime(record) {
  const options = record.timeValid
    ? { timeZone: TIME_ZONE, day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }
    : { timeZone: TIME_ZONE, day: "numeric", month: "long" };
  return new Intl.DateTimeFormat("it-IT", options).format(record.start);
}

function matchEntry(record) {
  const title = record.completed
    ? `${record.italian} ${record.winner ? "batte" : "perde con"} ${record.opponent}`
    : `${record.italian} vs ${record.opponent}`;
  const details = [record.round, italianDateTime(record)];
  if ((record.completed || record.inProgress) && record.score) details.push(record.score);
  if (record.inProgress && record.statusDetail) details.push(record.statusDetail);
  if (!record.completed && !record.inProgress && !record.timeValid) details.push("orario da confermare");
  const tv = record.completed ? "" : `<p class="watch">${television(record.league).join(". ")}.</p>`;
  return `<div class="match-entry"><span class="tournament">${record.tournament}</span><h3>${title}</h3><p>${details.join(" · ")}.</p>${tv}</div>`;
}

function groupCard(label, records, className, { completed = false } = {}) {
  const count = `${records.length} ${records.length === 1 ? "incontro" : "incontri"}`;
  if (!records.length) {
    return `        <article class="match match-group ${className}"><span class="state">${label} · 0 incontri</span><p class="empty-state">Nessun incontro al momento.</p></article>`;
  }
  if (!completed || records.length <= 2) {
    return `        <article class="match match-group ${className}"><span class="state">${label} · ${count}</span><div class="match-list">${records.map(matchEntry).join("")}</div></article>`;
  }
  const visible = records.slice(-2);
  const older = records.slice(0, -2).reverse();
  const moreLabel = `Vedi altri ${older.length} ${older.length === 1 ? "risultato" : "risultati"}`;
  return `        <article class="match match-group ${className}"><span class="state">${label} · ${count}</span><div class="match-list">${visible.map(matchEntry).join("")}</div><details class="more-results"><summary>${moreLabel}</summary><div class="match-list older-results">${older.map(matchEntry).join("")}</div></details></article>`;
}

function updatePage(raw, records, now) {
  const completed = records.filter(record => record.completed).sort((a, b) => a.start - b.start);
  const live = records.filter(record => record.inProgress).sort((a, b) => a.start - b.start);
  const upcoming = records.filter(record => !record.completed && !record.inProgress).sort((a, b) => a.start - b.start);
  const groups = [
    groupCard("Conclusi", completed, "done results", { completed: true }),
    groupCard("In corso", live, "live"),
    groupCard("In programma", upcoming, "upcoming"),
  ];
  const content = groups.join("\n");
  let updated = raw.replace(/Aggiornato il [^<]+/i, `Aggiornato automaticamente il ${italianDate(now)}`);
  updated = updated.replace(/(?<=<!-- AUTO_SCHEDULE_START -->)[\s\S]*?(?=<!-- AUTO_SCHEDULE_END -->)/, `\n${content}\n        `);
  return updated;
}

const now = new Date();
const scoreboard = await fetchScoreboards(now);
const oldCalendar = await readFile(CALENDAR_PATH, "utf8");
const savedSeason = Number(unfold(oldCalendar).match(/^X-CURRENT-TENNIS-SEASON:(\d{4})$/m)?.[1]);
const sourceSeason = scoreboard.activeSeasons.length ? Math.max(...scoreboard.activeSeasons) : 0;
const currentSeason = Math.max(savedSeason || fallbackSeason(now), sourceSeason);
const records = scoreboard.records.filter(record => record.season >= currentSeason);

const newCalendar = updateCalendar(oldCalendar, records, now, currentSeason);
if (newCalendar !== oldCalendar) await writeFile(CALENDAR_PATH, newCalendar);

const oldPage = await readFile(PAGE_PATH, "utf8");
const newPage = updatePage(oldPage, records, now);
if (newPage !== oldPage) await writeFile(PAGE_PATH, newPage);

console.log(`Controllate ${records.length} partite confermate; calendario ${newCalendar === oldCalendar ? "invariato" : "aggiornato"}.`);
