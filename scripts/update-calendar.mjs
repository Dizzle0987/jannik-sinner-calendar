import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fallbackSeason, parseIcsDate, TIME_ZONE } from "./tennis-season.mjs";

const ROOT = new URL("../", import.meta.url);
const CALENDAR_PATH = new URL("calendar.ics", ROOT);
const PAGE_PATH = new URL("index.html", ROOT);
const BROADCAST_CACHE_PATH = new URL("data/verified-broadcasts.json", ROOT);
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/tennis";
const HOUR_MS = 60 * 60 * 1000;

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

function refreshCadence(raw, now) {
  const blocks = [...raw.matchAll(/BEGIN:VEVENT\r?\n[\s\S]*?END:VEVENT/g)].map(match => match[0]);
  let nearMatch = false;
  let activeTournament = false;
  for (const block of blocks) {
    const start = parseIcsDate(field(block, "DTSTART"));
    if (!start) continue;
    const description = normalized(field(block, "DESCRIPTION")).replaceAll("\\n", " ");
    const completed = description.includes("conclusa:");
    const inProgress = description.includes("in corso");
    const distance = start - now;
    if (inProgress || (!completed && distance >= -0.5 * HOUR_MS && distance <= 4 * HOUR_MS)) nearMatch = true;
    if ((!completed && distance >= -4 * HOUR_MS && distance <= 72 * HOUR_MS)
      || (completed && distance >= -48 * HOUR_MS && distance <= 0)) activeTournament = true;
  }
  if (nearMatch) return { label: "partita", hours: 0.25 };
  if (activeTournament) return { label: "torneo attivo", hours: 1 };
  return { label: "periodo inattivo", hours: 6 };
}

function scheduledSlotIsDue(cadence, now) {
  if (cadence.hours === 0.25) return true;
  const hourlySlot = now.getUTCMinutes() >= 11 && now.getUTCMinutes() < 26;
  if (!hourlySlot) return false;
  return cadence.hours === 1 || now.getUTCHours() % 6 === 0;
}

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

function paidAndKnownBroadcasts(record) {
  if (record.season === 2026 && /Rolex Shanghai Masters/i.test(record.tournament)) {
    return [{
      label: "Italia: Sky Sport Tennis e NOW",
      access: "A pagamento",
      country: "🇮🇹",
      priority: 50,
      source: "https://sport.sky.it/tennis/2026/10/06/atp-shanghai-2026-dove-vedere-tv-streaming",
    }];
  }
  if (record.season === 2026 && /RoveretOpen/i.test(record.tournament)) {
    return [{
      label: "Italia: SuperTennis e SuperTennis Plus",
      access: "GRATIS",
      country: "🇮🇹",
      priority: 100,
      source: "https://www.vitatrentina.it/2026/10/09/dal-12-al-18-ottobre-il-roveretopen-citta-della-pace-femminile-di-tennis/",
    }];
  }
  return [];
}

const lastName = name => normalized(name).split(/\s+/).at(-1);
const htmlText = html => normalized(String(html).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
const pageConfirmsPlayers = (html, record) => {
  const text = htmlText(html);
  return text.includes(lastName(record.italian)) && text.includes(lastName(record.opponent));
};

function parseServusEpg(html) {
  const rows = [];
  for (const fragment of html.split("},{")) {
    const start = fragment.match(/\\"start_time\\":\\"([^\\"]+)\\"/)?.[1];
    const end = fragment.match(/\\"end_time\\":\\"([^\\"]+)\\"/)?.[1];
    const titles = [...fragment.matchAll(/\\"title\\":\\"(.*?)\\"/g)];
    if (!start || !end || !titles.length) continue;
    let title = titles.at(-1)[1];
    try { title = JSON.parse(`"${title}"`); } catch {}
    rows.push({ title, start: new Date(start), end: new Date(end) });
  }
  return rows;
}

function programmeConfirmsRecord(programme, record) {
  if (!programme.start || !programme.end || Number.isNaN(programme.start.getTime()) || Number.isNaN(programme.end.getTime())) return false;
  const title = normalized(programme.title);
  if (!title.includes(lastName(record.italian)) || !title.includes(lastName(record.opponent))) return false;
  return programme.start <= addHours(record.start, 0.25) && programme.end >= addHours(record.start, 1.25);
}

async function readBroadcastCache() {
  try {
    const parsed = JSON.parse(await readFile(BROADCAST_CACHE_PATH, "utf8"));
    return parsed?.version === 1 && parsed.records ? parsed : { version: 1, records: {} };
  } catch {
    return { version: 1, records: {} };
  }
}

async function attachVerifiedFreeBroadcasts(records, now) {
  const targets = records.filter(record => !record.completed && record.timeValid);
  if (!targets.length) return;
  const cache = await readBroadcastCache();
  for (const record of targets) {
    const cached = cache.records[record.id];
    if (cached?.options?.length) record.verifiedFreeBroadcasts = cached.options;
  }
  const due = targets.filter(record => {
    const checkedAt = new Date(cache.records[record.id]?.checkedAt ?? 0);
    const distance = record.start - now;
    const refreshMs = distance >= -4 * HOUR_MS && distance <= 24 * HOUR_MS ? 3 * HOUR_MS : 6 * HOUR_MS;
    return Number.isNaN(checkedAt.getTime()) || now - checkedAt >= refreshMs;
  });
  if (!due.length) return;
  const fresh = new Map(due.map(record => [record.id, []]));
  let successfulSources = 0;
  const headers = { "User-Agent": "Italian-Tennis-Calendar/1.0" };

  try {
    const response = await fetch("https://www.servustv.com/de/epg", { headers });
    if (response.ok) {
      successfulSources += 1;
      const programmes = parseServusEpg(await response.text());
      for (const record of due) {
        if (programmes.some(programme => programmeConfirmsRecord(programme, record))) {
          fresh.get(record.id).push({
            label: "Austria: ServusTV / ServusTV On",
            access: "GRATIS",
            country: "🇦🇹",
            priority: 130,
            source: "https://www.servustv.com/de/epg",
          });
        }
      }
    }
  } catch {}

  try {
    const response = await fetch("https://plus.supertennis.tv/live", { headers });
    if (response.ok) {
      successfulSources += 1;
      const html = await response.text();
      for (const record of due) {
        if (pageConfirmsPlayers(html, record)) {
          fresh.get(record.id).push({
            label: "Italia: SuperTennis Plus",
            access: "GRATIS",
            country: "🇮🇹",
            priority: 110,
            source: "https://plus.supertennis.tv/live",
          });
        }
      }
    }
  } catch {}

  try {
    const response = await fetch("https://tv.orf.at/", { headers });
    if (response.ok) {
      successfulSources += 1;
      const index = await response.text();
      const pages = new Map();
      for (const record of due) {
        const [year, month, day] = record.date.split("-");
        for (const channel of ["orf1", "orf2", "orfs"]) {
          const pattern = new RegExp(`href="(?<path>/program/${channel}/index~_day-${day}-${month}-${year}_[^"]+\\.html)"`);
          const path = index.match(pattern)?.groups?.path;
          if (!path) continue;
          const url = new URL(path, "https://tv.orf.at/").href;
          if (!pages.has(url)) {
            const page = await fetch(url, { headers });
            pages.set(url, page.ok ? await page.text() : "");
          }
          if (pageConfirmsPlayers(pages.get(url), record)) {
            fresh.get(record.id).push({
              label: `Austria: ${channel === "orfs" ? "ORF SPORT +" : channel.toUpperCase()} / ORF ON`,
              access: "GRATIS",
              country: "🇦🇹",
              priority: 125,
              source: url,
            });
          }
        }
      }
    }
  } catch {}

  if (successfulSources !== 3) return;
  const activeIds = new Set(targets.map(record => record.id));
  for (const id of Object.keys(cache.records)) if (!activeIds.has(id)) delete cache.records[id];
  for (const record of due) {
    record.verifiedFreeBroadcasts = fresh.get(record.id);
    cache.records[record.id] = {
      checkedAt: now.toISOString(),
      options: record.verifiedFreeBroadcasts,
    };
  }
  await mkdir(new URL("data/", ROOT), { recursive: true });
  await writeFile(BROADCAST_CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`);
}

function television(record) {
  const options = [...(record.verifiedFreeBroadcasts ?? []), ...paidAndKnownBroadcasts(record)];
  const rank = option => option.access !== "GRATIS" ? 3 : option.country === "🇮🇹" ? 0 : option.country === "🇦🇹" ? 1 : 2;
  const unique = [...new Map(options.map(option => [`${option.country}-${option.label}`, option])).values()]
    .sort((a, b) => rank(a) - rank(b) || b.priority - a.priority);
  return {
    options: unique,
    freeConfirmed: unique.some(option => option.access === "GRATIS"),
  };
}

function recordFromCompetition(tournament, grouping, competition, league) {
  if (!String(grouping?.grouping?.slug ?? competition?.type?.slug).includes("singles")) return null;
  const competitors = (competition.competitors ?? []).filter(item => item.athlete?.displayName);
  if (competitors.length !== 2) return null;
  const italian = competitors.find(item => PLAYERS.get(item.athlete.displayName) === league);
  if (!italian) return null;
  const opponent = competitors.find(item => item !== italian);
  const opponentPending = opponent.athlete.displayName === "TBD";
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
    opponent: opponentPending ? (league === "wta" ? "Avversaria da definire" : "Avversario da definire") : opponent.athlete.displayName,
    opponentPending,
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
  const broadcast = record.completed ? null : television(record);
  const broadcastLines = record.completed
    ? []
    : [
        ...(broadcast.options.length ? ["Dove vederla:"] : []),
        ...broadcast.options.flatMap(option => [
          `${option.country} ${option.label} — ${option.access}`,
          `Fonte TV: ${option.source}`,
        ]),
        ...(broadcast.options.length && !broadcast.freeConfirmed ? ["Alternativa gratuita non ancora confermata"] : []),
        ...(!broadcast.options.length ? ["Copertura TV non ancora confermata"] : []),
      ];
  const description = [
    `${record.tournament} - ${record.round}`,
    record.completed
      ? `Conclusa: ${record.winner ? "vittoria" : "sconfitta"} ${record.italian}${record.score ? ` ${record.score}` : ""}`
      : record.inProgress
        ? `In corso${record.score ? `: ${record.score}` : ""}`
        : record.opponentPending
          ? `In programma; ${record.league === "wta" ? "avversaria" : "avversario"}, data e orario da confermare`
        : record.timeValid ? "In programma" : "In programma; orario da confermare",
    "Superficie e programma soggetti agli aggiornamenti del torneo",
    ...broadcastLines,
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
    `SUMMARY:${escapeText(record.opponentPending ? `${record.italian} - prossimo turno` : `${record.italian} vs ${record.opponent}`)}`,
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
  const title = record.opponentPending
    ? `${record.italian} — prossimo turno`
    : record.completed
    ? `${record.italian} ${record.winner ? "batte" : "perde con"} ${record.opponent}`
    : `${record.italian} vs ${record.opponent}`;
  const details = [record.round, record.opponentPending ? `${record.opponent}; data e orario da confermare` : italianDateTime(record)];
  if ((record.completed || record.inProgress) && record.score) details.push(record.score);
  if (record.inProgress && record.statusDetail) details.push(record.statusDetail);
  if (!record.completed && !record.inProgress && !record.timeValid && !record.opponentPending) details.push("orario da confermare");
  const broadcast = record.completed ? null : television(record);
  const tv = record.completed
    ? ""
    : `<div class="watch">${broadcast.options.map(option => `<span class="broadcast-option"><b>${option.access}</b> ${option.country} ${option.label}. <a href="${option.source}" target="_blank" rel="noopener">Fonte ↗</a></span>`).join("")}${broadcast.options.length && !broadcast.freeConfirmed ? '<span class="broadcast-tbc">Alternativa gratuita non ancora confermata.</span>' : ""}${!broadcast.options.length ? '<span class="broadcast-tbc">Copertura TV non ancora confermata.</span>' : ""}</div>`;
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
  const visible = records.slice(0, 2);
  const older = records.slice(2);
  const moreLabel = `Vedi altri ${older.length} ${older.length === 1 ? "risultato" : "risultati"}`;
  return `        <article class="match match-group ${className}"><span class="state">${label} · ${count}</span><div class="match-list">${visible.map(matchEntry).join("")}</div><details class="more-results"><summary>${moreLabel}</summary><div class="match-list older-results">${older.map(matchEntry).join("")}</div></details></article>`;
}

function updatePage(raw, records, now) {
  const newestFirst = (a, b) => b.start - a.start;
  const completed = records.filter(record => record.completed).sort(newestFirst);
  const live = records.filter(record => record.inProgress).sort(newestFirst);
  const upcoming = records.filter(record => !record.completed && !record.inProgress).sort(newestFirst);
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
const oldCalendar = await readFile(CALENDAR_PATH, "utf8");
const cadence = refreshCadence(oldCalendar, now);
if (process.env.SCHEDULED_RUN === "true" && !scheduledSlotIsDue(cadence, now)) {
  console.log(`Controllo rinviato: ${cadence.label}, cadenza ${cadence.hours === 0.25 ? "15 minuti" : `${cadence.hours} ore`}.`);
  process.exit(0);
}
const scoreboard = await fetchScoreboards(now);
const savedSeason = Number(unfold(oldCalendar).match(/^X-CURRENT-TENNIS-SEASON:(\d{4})$/m)?.[1]);
const sourceSeason = scoreboard.activeSeasons.length ? Math.max(...scoreboard.activeSeasons) : 0;
const currentSeason = Math.max(savedSeason || fallbackSeason(now), sourceSeason);
const records = scoreboard.records.filter(record => record.season >= currentSeason);
await attachVerifiedFreeBroadcasts(records, now);

const newCalendar = updateCalendar(oldCalendar, records, now, currentSeason);
if (newCalendar !== oldCalendar) await writeFile(CALENDAR_PATH, newCalendar);

const oldPage = await readFile(PAGE_PATH, "utf8");
const newPage = updatePage(oldPage, records, now);
if (newPage !== oldPage) await writeFile(PAGE_PATH, newPage);

console.log(`Controllati ${records.length} eventi confermati o provvisori; calendario ${newCalendar === oldCalendar ? "invariato" : "aggiornato"}.`);
