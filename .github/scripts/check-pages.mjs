import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const repository = process.env.GITHUB_REPOSITORY;
const api = `https://api.github.com/repos/${repository}`;
const pages = "https://dizzle0987.github.io/jannik-sinner-calendar/";
const issueTitle = "Italian Tennis Calendar: pubblicazione Pages non aggiornata";
const files = [["index.html", pages], ["calendar.ics", `${pages}calendar.ics`]];

async function head() {
  const response = await fetch(`${api}/git/ref/heads/main`, {
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      "Cache-Control": "no-cache",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Lettura di main: HTTP ${response.status}`);
  return (await response.json()).object.sha;
}

async function verifyFile(sha, file, url, attempt) {
  const expected = await fetch(`https://raw.githubusercontent.com/${repository}/${sha}/${file}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!expected.ok) throw new Error(`Lettura di ${file} su main: HTTP ${expected.status}`);
  const expectedBytes = Buffer.from(await expected.arrayBuffer());
  try {
    const response = await fetch(`${url}?pages-health=${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}-${attempt}`, {
      headers: { "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== 200) return `${file}: HTTP ${response.status}`;
    if (!expectedBytes.equals(Buffer.from(await response.arrayBuffer()))) {
      return `${file}: il contenuto pubblico differisce da main`;
    }
    return null;
  } catch (error) {
    return `${file}: richiesta al sito pubblico fallita (${error.message})`;
  }
}

function issue(...args) {
  return execFileSync("gh", ["issue", ...args, "--repo", repository], { encoding: "utf8" });
}

async function main() {
  let sha;
  let problems;
  let firstMismatch;
  let gracePeriodElapsed = false;
  // Give GitHub Pages five minutes to deploy before treating a difference as an incident.
  for (let attempt = 0; attempt < 16; attempt++) {
    if (attempt > 0) await delay(30_000);
    sha = await head();
    problems = (await Promise.all(files.map(([file, url]) => verifyFile(sha, file, url, attempt)))).filter(Boolean);
    if (sha !== await head()) {
      problems = null;
      firstMismatch = undefined;
      console.log("main è cambiato durante il controllo. Riprovo sul nuovo commit.");
      continue;
    }
    if (!problems.length) break;
    console.log(`Controllo ${attempt + 1}: ${problems.join(" | ")}`);
    if (firstMismatch?.sha !== sha) firstMismatch = { sha, attempt };
    if (attempt - firstMismatch.attempt >= 10) {
      gracePeriodElapsed = true;
      break;
    }
  }

  if (!problems || (problems.length && !gracePeriodElapsed)) {
    throw new Error("main è cambiato troppo di recente per stabilire se il deploy è in ritardo.");
  }
  const incidents = JSON.parse(execFileSync("gh", ["api", "--method", "GET", "--paginate", "--slurp",
    `repos/${repository}/issues`, "-f", "state=open", "-f", "creator=github-actions[bot]", "-F", "per_page=100"],
  { encoding: "utf8" })).flat();
  const incident = incidents.find(item => !item.pull_request && item.title === issueTitle);
  const runUrl = `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  if (problems.length) {
    if (!incident) {
      const body = [
        `Dopo i tentativi di verifica, GitHub Pages non serve i file attesi per il commit \`${sha}\`.`,
        ...problems.map(problem => `- ${problem}`),
        "",
        `[Esecuzione del controllo](${runUrl})`,
      ].join("\n");
      console.log(issue("create", "--title", issueTitle, "--body", body).trim());
    }
    throw new Error(problems.join(" | "));
  }

  console.log(`Homepage e calendario corrispondono a main (${sha}).`);
  if (incident) {
    console.log(issue("close", String(incident.number), "--reason", "completed",
      "--comment", `Homepage e feed .ics corrispondono di nuovo a main (\`${sha}\`). [Controllo riuscito](${runUrl}).`).trim());
  }
}

await main();
