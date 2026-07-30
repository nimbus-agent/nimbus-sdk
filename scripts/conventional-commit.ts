/**
 * Conventional Commit parsing, and the rule that an aggregate PR subject may not
 * under-declare the release impact of the commits it squashes away.
 *
 * Why this exists: release-please parses the commits that land on `main`, and this repo
 * merges by squash only. When a stack of feature PRs is collected on a dev branch and that
 * branch reaches `main` through one aggregate PR, the aggregate's subject is the *only*
 * thing the parser sees — every constituent subject is one level below its view. `sdk 1.9.0`
 * shipped four PRs' worth of change while crediting one, because the aggregate subject
 * (`Phase 1: lift the contract out of TypeScript — wire spec and manifest rule registry`)
 * was not a Conventional Commit and the parser recognized nothing in it.
 *
 * The changelog gap was the visible symptom; the version number is the real hazard. That
 * release's minor bump came entirely from the one PR that targeted `main` directly. Had it
 * been a `fix`, a new public export would have shipped in a patch — and the same mechanism
 * applied to a `feat!` would publish a breaking change as a patch.
 *
 * So two rules, checked against every PR targeting `main`:
 *
 *   1. The subject parses as a Conventional Commit, so release-please classifies it at all.
 *   2. Its declared impact is at least the highest impact among the commits it carries — a
 *      stack containing a `feat` cannot merge as `docs:`, and one containing a breaking
 *      change cannot merge without `!`.
 *
 * Over-declaring is deliberately allowed: `feat:` on a stack of `fix:`es only over-bumps,
 * which costs a version number and breaks nothing. Under-declaring is what loses semver.
 *
 * Pure: no network, no file reads, no process state. `conventional-commit-guard.ts` is the
 * thin glue that fetches a PR's title and commits and calls into here.
 */

/** Release impact, ordered by how much of the version number it moves. */
export type ReleaseImpact = "none" | "patch" | "minor" | "major";

const IMPACT_ORDER: readonly ReleaseImpact[] = ["none", "patch", "minor", "major"];

/** A commit subject decomposed into its Conventional Commit parts. */
export interface ConventionalSubject {
  readonly type: string;
  /** The parenthesized scope, or undefined when the subject carries none. */
  readonly scope: string | undefined;
  /** True when the subject declares a breaking change with `!`. */
  readonly breaking: boolean;
  readonly description: string;
}

/**
 * `type(scope)!: description`.
 *
 * Lowercase types only. The Conventional Commits spec permits any casing, but release-please
 * is what actually reads these, and a subject it fails to classify is exactly the failure
 * being guarded against — so anything outside the shape release-please reliably parses is
 * reported rather than accepted. The scope, when present, must be non-empty: `feat(): x` is
 * malformed, and silently treating it as scopeless would accept a typo.
 */
const SUBJECT = /^([a-z]+)(?:\(([^()]+)\))?(!)?: (.+)$/;

/**
 * A `BREAKING CHANGE:` / `BREAKING-CHANGE:` footer, which makes a commit major regardless
 * of its type. Matched at line start only — the phrase in running prose is not a footer.
 */
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE: .+/m;

/**
 * Types that move the minor and patch positions.
 *
 * `feat` → minor and `fix` → patch are the spec. `perf` and `revert` are included as patch
 * because release-please's `node` release type gives them changelog sections and a patch
 * bump; if that ever stops being true, the cost of the assumption is a stack of `perf:`
 * commits being required to declare `fix:` or higher at the aggregate — stricter than
 * necessary, never looser. Erring the other way would let a real bump go unrequested.
 */
export const MINOR_TYPES: ReadonlySet<string> = new Set<string>(["feat"]);
export const PATCH_TYPES: ReadonlySet<string> = new Set<string>(["fix", "perf", "revert"]);

/** Parse a single commit subject line. Returns null when it is not a Conventional Commit. */
export function parseConventionalSubject(subject: string): ConventionalSubject | null {
  const match = SUBJECT.exec(subject.trim());
  if (match === null) {
    return null;
  }
  const [, type, scope, bang, description] = match;
  // The regex cannot match without groups 1 and 4, but the compiler does not know that
  // and a non-null assertion is banned repo-wide.
  if (type === undefined || description === undefined) {
    return null;
  }
  return { type, scope, breaking: bang === "!", description };
}

/** The release impact a parsed subject declares, ignoring any footer. */
export function impactOfSubject(subject: ConventionalSubject): ReleaseImpact {
  if (subject.breaking) {
    return "major";
  }
  if (MINOR_TYPES.has(subject.type)) {
    return "minor";
  }
  if (PATCH_TYPES.has(subject.type)) {
    return "patch";
  }
  return "none";
}

/**
 * The release impact of a whole commit message — subject plus body, so a `BREAKING CHANGE:`
 * footer is honored.
 *
 * A message whose subject does not parse is `"none"`: release-please classifies nothing in
 * it, so it contributes nothing to the bump. That is a true statement about the bump and a
 * blind spot in this check at the same time — see `opaque` in {@link AggregateVerdict}.
 */
export function impactOfMessage(message: string): ReleaseImpact {
  const newline = message.indexOf("\n");
  const subjectLine = newline === -1 ? message : message.slice(0, newline);
  const parsed = parseConventionalSubject(subjectLine);
  if (parsed === null) {
    return "none";
  }
  const body = newline === -1 ? "" : message.slice(newline + 1);
  if (BREAKING_FOOTER.test(body)) {
    return "major";
  }
  return impactOfSubject(parsed);
}

/** Negative when `a` is the weaker impact, positive when stronger, 0 when equal. */
export function compareImpact(a: ReleaseImpact, b: ReleaseImpact): number {
  return IMPACT_ORDER.indexOf(a) - IMPACT_ORDER.indexOf(b);
}

/** The first line of a commit message. */
export function subjectOf(message: string): string {
  const newline = message.indexOf("\n");
  return (newline === -1 ? message : message.slice(0, newline)).trim();
}

/** One commit reached by an aggregate PR. */
export interface CarriedCommit {
  /** Short or full SHA — used only to name the commit in a failure message. */
  readonly sha: string;
  /** The full commit message, subject and body. */
  readonly message: string;
}

export interface AggregateVerdict {
  readonly ok: boolean;
  /** Human-readable rule failures. Empty when `ok`. */
  readonly violations: readonly string[];
  /**
   * Commits whose subject is not a Conventional Commit, and so cannot be classified.
   *
   * Not a failure: release-please ignores them, so they genuinely contribute nothing to the
   * bump the aggregate must cover. They are reported because they are this check's residual
   * blind spot — a commit that hides a feature behind `wip` is invisible here, and the only
   * complete fix for that is to stop squashing stacks (see issue #64, option 1 or 3).
   */
  readonly opaque: readonly string[];
  /** What the subject declared. */
  readonly declared: ReleaseImpact;
  /** The highest impact found among the carried commits. */
  readonly required: ReleaseImpact;
}

export interface AggregateInput {
  /** The subject that will land on `main` — for a squash merge, the PR title. */
  readonly title: string;
  readonly commits: readonly CarriedCommit[];
}

/**
 * Every subject that GitHub might use for the squash commit, weakest first.
 *
 * With `squash_merge_commit_title = COMMIT_OR_PR_TITLE` — the repository's setting — GitHub
 * uses the PR title only when the PR has more than one commit; a **single-commit** PR lands
 * that commit's own subject instead. So checking the PR title alone leaves a hole exactly
 * one commit wide: a PR titled `feat(sdk): …` whose only commit reads `wip` would pass while
 * putting `wip` on `main`.
 *
 * Both candidates are therefore checked, which is also correct under
 * `squash_merge_commit_title = PR_TITLE`, where only the title can land. A conforming
 * single-commit PR normally has the same text in both places, so this costs nothing.
 */
function landingSubjects(input: AggregateInput): ReadonlyArray<{ label: string; subject: string }> {
  const candidates = [{ label: "The PR title", subject: input.title.trim() }];
  const only = input.commits.length === 1 ? input.commits[0] : undefined;
  if (only !== undefined) {
    const subject = subjectOf(only.message);
    if (subject !== input.title.trim()) {
      candidates.push({
        label:
          `The sole commit's subject (${only.sha.slice(0, 8)}), which a squash merge of a` +
          ` one-commit PR uses in place of the title`,
        subject,
      });
    }
  }
  return candidates;
}

/**
 * Check a `main`-targeting PR against the commits it carries.
 *
 * A single-commit PR is mostly the same check with a one-element list — the rule "declare at
 * least what you carry" is trivially satisfied when the subject *is* the commit — with the
 * one wrinkle described on {@link landingSubjects}.
 */
export function checkAggregate(input: AggregateInput): AggregateVerdict {
  const violations: string[] = [];
  const opaque: string[] = [];

  // The weakest thing that could land is what the release must survive.
  let declared: ReleaseImpact = "major";
  for (const candidate of landingSubjects(input)) {
    const parsed = parseConventionalSubject(candidate.subject);
    if (parsed === null) {
      declared = "none";
      violations.push(
        `${candidate.label} is not a Conventional Commit:\n` +
          `    ${candidate.subject}\n` +
          `  release-please parses commits on \`main\`; a subject it cannot classify is ` +
          `dropped from the changelog and contributes nothing to the version bump.\n` +
          `  Expected \`type(optional-scope)!: description\` with a lowercase type, ` +
          `e.g. \`feat(sdk): publish the manifest rule registry\`.`,
      );
      continue;
    }
    const impact = impactOfSubject(parsed);
    if (compareImpact(impact, declared) < 0) {
      declared = impact;
    }
  }

  let required: ReleaseImpact = "none";
  const demanding: Map<ReleaseImpact, string[]> = new Map();

  for (const commit of input.commits) {
    const subjectLine = subjectOf(commit.message);
    if (parseConventionalSubject(subjectLine) === null) {
      opaque.push(`${commit.sha.slice(0, 8)} ${subjectLine}`);
      continue;
    }
    const impact = impactOfMessage(commit.message);
    if (compareImpact(impact, required) > 0) {
      required = impact;
    }
    const bucket = demanding.get(impact) ?? [];
    bucket.push(`${commit.sha.slice(0, 8)} ${subjectLine}`);
    demanding.set(impact, bucket);
  }

  if (compareImpact(declared, required) < 0) {
    const offenders = demanding.get(required) ?? [];
    violations.push(
      `The subject that will land declares \`${declared}\`, but the PR carries a ` +
        `\`${required}\` change.\n` +
        `  A squash merge collapses these commits into that one subject, so it is the ` +
        `only thing release-please will classify:\n` +
        offenders.map((line) => `    ${line}`).join("\n") +
        `\n  ${remedyFor(required)}`,
    );
  }

  return { ok: violations.length === 0, violations, opaque, declared, required };
}

function remedyFor(required: ReleaseImpact): string {
  if (required === "major") {
    return (
      "Add `!` to the subject (e.g. `feat(sdk)!: …`) so the release is a major, " +
      "or split the breaking commit into its own PR against `main`."
    );
  }
  if (required === "minor") {
    return "Use `feat` in the subject so the release is a minor, or split the feature out.";
  }
  return "Use `fix` in the subject so the release is a patch, or split the fix out.";
}
