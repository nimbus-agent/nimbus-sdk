/**
 * CI entry point for the Conventional Commit rules in `conventional-commit.ts`.
 *
 * Thin glue by design: everything decidable lives in the pure module next door, under unit
 * test, so this file holds only the parts that need the network and the environment — read
 * the event payload, fetch the PR's commits, print, set an exit code.
 *
 * Runs on `pull_request` events targeting `main`. On anything else it exits 0 with a note
 * rather than being skipped by an `if:` in the workflow: `ci-complete` treats a skipped
 * dependency as a failure, so a job that opts out of a push build must do so from the
 * inside.
 *
 * Also usable locally against any PR, which is how the rules were checked against the
 * release this guard exists to prevent:
 *
 *   GITHUB_REPOSITORY=nimbus-agent/nimbus-sdk GH_TOKEN=$(gh auth token) \
 *     bun run scripts/conventional-commit-guard.ts --pr 59
 *
 * `--help` prints that recipe; `--pr` without a number is an error rather than a fall-back
 * to the event payload, because outside CI there is no event payload and the fall-back
 * printed "nothing to check" and exited 0 — a typo that read exactly like a pass.
 *
 * Exit codes: 0 pass or not applicable, 1 a rule failed, 2 the check could not run.
 */
import { type CarriedCommit, checkAggregate } from "./conventional-commit.ts";

const EXIT_OK = 0;
const EXIT_VIOLATION = 1;
const EXIT_ERROR = 2;

/** The branch whose commit history release-please reads. */
const RELEASE_BRANCH = "main";

const USAGE = `Usage: bun run scripts/conventional-commit-guard.ts [--pr <number>]

Asserts that the subject which will land on ${RELEASE_BRANCH} — a squashed pull request's
title — is a Conventional Commit and declares at least what its commits carry.

  --pr <number>   check that pull request instead of the current event payload
  --help, -h      print this

Environment:
  GITHUB_REPOSITORY   owner/name (required)
  GITHUB_TOKEN | GH_TOKEN   a token that can read pull requests (required)
  GITHUB_API_URL      defaults to https://api.github.com
  GITHUB_EVENT_NAME / GITHUB_EVENT_PATH   set by Actions; used when --pr is absent

Locally:
  GITHUB_REPOSITORY=nimbus-agent/nimbus-sdk GH_TOKEN=$(gh auth token) \\
    bun run scripts/conventional-commit-guard.ts --pr 59

Exit codes: 0 pass or not applicable, 1 a rule failed, 2 the check could not run.
`;

/**
 * GitHub caps this endpoint at 250 commits and paginates at 100. A PR that large is not a
 * stack anyone reviews, but the cap is real: past it, `hasMore` stays true and we would
 * loop forever, so the page count is bounded and truncation is reported rather than hidden.
 */
const PER_PAGE = 100;
const MAX_PAGES = 3;

function out(text: string): void {
  process.stdout.write(text);
}

/** Narrow parsed JSON to an object without reaching for `any`. */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Percent-encode the characters GitHub's annotation format treats as delimiters. */
function encodeAnnotation(message: string): string {
  return message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

interface PullRequestRef {
  readonly number: number;
  readonly title: string;
  readonly baseRef: string;
}

async function pullRequestFromEvent(path: string): Promise<PullRequestRef | null> {
  const payload = asRecord(await Bun.file(path).json());
  const pr = payload === null ? null : asRecord(payload["pull_request"]);
  if (pr === null) {
    return null;
  }
  const number = pr["number"];
  const title = asString(pr["title"]);
  const base = asRecord(pr["base"]);
  const baseRef = base === null ? null : asString(base["ref"]);
  if (typeof number !== "number" || title === null || baseRef === null) {
    return null;
  }
  return { number, title, baseRef };
}

async function pullRequestFromApi(
  apiUrl: string,
  repo: string,
  token: string,
  number: number,
): Promise<PullRequestRef | null> {
  const response = await fetch(`${apiUrl}/repos/${repo}/pulls/${number}`, {
    headers: apiHeaders(token),
  });
  if (!response.ok) {
    out(`error: GET /pulls/${number} returned ${response.status}\n`);
    return null;
  }
  const pr = asRecord(await response.json());
  const title = pr === null ? null : asString(pr["title"]);
  const base = pr === null ? null : asRecord(pr["base"]);
  const baseRef = base === null ? null : asString(base["ref"]);
  if (title === null || baseRef === null) {
    return null;
  }
  return { number, title, baseRef };
}

function apiHeaders(token: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2022-11-28",
  };
}

async function fetchCommits(
  apiUrl: string,
  repo: string,
  token: string,
  number: number,
): Promise<{ commits: CarriedCommit[]; truncated: boolean } | null> {
  const commits: CarriedCommit[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${apiUrl}/repos/${repo}/pulls/${number}/commits?per_page=${PER_PAGE}&page=${page}`;
    const response = await fetch(url, { headers: apiHeaders(token) });
    if (!response.ok) {
      out(`error: GET /pulls/${number}/commits page ${page} returned ${response.status}\n`);
      return null;
    }
    const body: unknown = await response.json();
    if (!Array.isArray(body)) {
      out("error: the commits endpoint did not return an array\n");
      return null;
    }
    for (const entry of body) {
      const record = asRecord(entry);
      const commit = record === null ? null : asRecord(record["commit"]);
      const message = commit === null ? null : asString(commit["message"]);
      const sha = record === null ? null : asString(record["sha"]);
      if (message === null || sha === null) {
        out("error: a commit entry was missing its sha or message\n");
        return null;
      }
      commits.push({ sha, message });
    }
    if (body.length < PER_PAGE) {
      return { commits, truncated: false };
    }
  }
  return { commits, truncated: true };
}

async function main(): Promise<number> {
  const env = process.env;
  const eventName = env["GITHUB_EVENT_NAME"] ?? "";
  const eventPath = env["GITHUB_EVENT_PATH"] ?? "";
  const repo = env["GITHUB_REPOSITORY"] ?? "";
  const token = env["GITHUB_TOKEN"] ?? env["GH_TOKEN"] ?? "";
  const apiUrl = env["GITHUB_API_URL"] ?? "https://api.github.com";

  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    out(USAGE);
    return EXIT_OK;
  }

  // Presence and value are tracked separately. `--pr` as the last argument leaves the value
  // `undefined`, and treating that as "no flag given" fell through to the event-payload
  // branch, which outside CI prints "nothing to check" and exits 0 — the shape of a pass.
  const prFlagIndex = process.argv.indexOf("--pr");
  const prFlagGiven = prFlagIndex !== -1;
  const prFlag = prFlagGiven ? process.argv[prFlagIndex + 1] : undefined;

  if (prFlagGiven && prFlag === undefined) {
    out("error: --pr expects a pull request number, e.g. --pr 59\n");
    return EXIT_ERROR;
  }

  if (repo === "") {
    out("error: GITHUB_REPOSITORY is not set\n");
    return EXIT_ERROR;
  }
  if (token === "") {
    out("error: neither GITHUB_TOKEN nor GH_TOKEN is set\n");
    return EXIT_ERROR;
  }

  let target: PullRequestRef | null;
  if (prFlag !== undefined) {
    const number = Number.parseInt(prFlag, 10);
    if (!Number.isInteger(number) || number <= 0) {
      out(`error: --pr expects a positive integer, got "${prFlag}"\n`);
      return EXIT_ERROR;
    }
    target = await pullRequestFromApi(apiUrl, repo, token, number);
  } else if (eventName === "pull_request" || eventName === "pull_request_target") {
    if (eventPath === "") {
      out("error: GITHUB_EVENT_PATH is not set\n");
      return EXIT_ERROR;
    }
    target = await pullRequestFromEvent(eventPath);
  } else {
    // Not skipped — see the note at the top of this file about `ci-complete`.
    out(`Not a pull request event (${eventName || "none"}); nothing to check.\n`);
    return EXIT_OK;
  }

  if (target === null) {
    out("error: could not read the pull request's title and base branch\n");
    return EXIT_ERROR;
  }

  if (target.baseRef !== RELEASE_BRANCH) {
    out(
      `PR #${target.number} targets ${target.baseRef}, not ${RELEASE_BRANCH}; ` +
        `release-please does not read that branch, so the rules do not apply.\n`,
    );
    return EXIT_OK;
  }

  const fetched = await fetchCommits(apiUrl, repo, token, target.number);
  if (fetched === null) {
    return EXIT_ERROR;
  }

  const verdict = checkAggregate({ title: target.title, commits: fetched.commits });

  out(`PR #${target.number} → ${RELEASE_BRANCH}\n`);
  out(`  subject:  ${target.title}\n`);
  out(`  commits:  ${fetched.commits.length}${fetched.truncated ? " (truncated)" : ""}\n`);
  out(`  declared: ${verdict.declared}\n`);
  out(`  carried:  ${verdict.required}\n`);

  if (fetched.truncated) {
    out(
      `\nnote: only the first ${PER_PAGE * MAX_PAGES} commits were read, so a stronger ` +
        `change further down would not be seen.\n`,
    );
  }

  if (verdict.opaque.length > 0) {
    out(`\nnote: ${verdict.opaque.length} commit(s) are not Conventional Commits, so their\n`);
    out("      release impact cannot be read. release-please ignores them too, so they do\n");
    out("      not change the required bump — but a feature hidden in one is invisible here:\n");
    for (const line of verdict.opaque) {
      out(`      ${line}\n`);
    }
  }

  if (verdict.ok) {
    out("\nok — the subject declares at least what the PR carries.\n");
    return EXIT_OK;
  }

  out("\n");
  for (const violation of verdict.violations) {
    out(`FAIL: ${violation}\n\n`);
  }
  out(
    `::error title=Conventional Commit guard::${encodeAnnotation(verdict.violations.join("\n\n"))}\n`,
  );
  return EXIT_VIOLATION;
}

process.exit(await main());
