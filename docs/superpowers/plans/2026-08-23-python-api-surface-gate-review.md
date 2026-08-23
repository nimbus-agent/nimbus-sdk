# Review & Feedback: Python API-Surface Gate Implementation Plan

**Date:** 2026-08-23  
**Plan Reference:** [2026-08-23-python-api-surface-gate.md](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/python-api-surface/docs/superpowers/plans/2026-08-23-python-api-surface-gate.md)

---

## 1. Open Questions

### Q1.1: Inherited Class Members vs. `vars(cls)`
*   **Context:** Task 4 uses `vars(cls).items()` to extract and render class members.
*   **Question:** `vars(cls)` only returns attributes defined directly in `cls`'s own namespace. If an SDK class inherits public methods or properties from a base class (such as a base `Response` class or a custom exception base class) without overriding them, they will be omitted from the surface snapshot. Is it the intention to only document overridden/local class members, or should the full inherited public surface of the class be recorded?
*   **Recommendation:** If inherited members are part of the public contract, consider walking the class MRO or using `inspect.classify_class_attrs(cls)` to capture inherited public methods and properties. If only locally defined members are desired, document this choice explicitly in `_render_class`.

### Q1.2: Modern Python Type Aliases (PEP 695 / Python 3.12+)
*   **Context:** Task 1 classifies type aliases using `_ALIAS_TYPES = (types.UnionType, types.GenericAlias)` and `getattr(obj, "__module__", None) == "typing"`.
*   **Question:** Python 3.12 introduced PEP 695 type aliases (using the `type` keyword, e.g. `type HelloResult = HelloOk | HelloRefused`). At runtime, these are instances of `typing.TypeAliasType`. While their `__module__` is still `"typing"`, does `alias_sources` (using `ast.parse`) correctly handle PEP 695 AST nodes (`ast.TypeAlias`) if they are introduced in the future?
*   **Recommendation:** Note that if the codebase eventually transitions to PEP 695 style aliases, `alias_sources`'s AST traversal will need to check for `ast.TypeAlias` in addition to `ast.Assign` to locate target ids.

---

## 2. Technical Suggestions & Improvements

### S2.1: Windows-Compatible Path in Verification Steps
*   **Context:** The verification step uses `/tmp/nimbus-verify` as the clone target:
    ```bash
    git clone --branch worktree-python-api-surface . /tmp/nimbus-verify
    ```
*   **Suggestion:** Since the host operating system is Windows, standard shells (e.g. Command Prompt or PowerShell) do not natively resolve `/tmp/...` unless running inside Git Bash or WSL. Standardizing the verification path to a Windows-compatible directory like `$env:TEMP/nimbus-verify` or `C:\Temp\nimbus-verify` prevents execution errors for local developers.

### S2.2: Callable Objects (Instances) in the Surface
*   **Context:** The classifier in Task 1 checks class, function, and alias types, defaulting everything else to `Kind.DATA`.
*   **Suggestion:** If any callable instance (an object defining `__call__` but which is not a function or class) is ever exported in `__all__`, it will default to `Kind.DATA` and render as `NAME: type`. This is generally correct, but we should make sure that if it needs to be shown as a callable signature, we handle `callable(obj)` and extract its `__call__` signature.

---

## 3. Disposition

All four findings applied to
[the plan](./2026-08-23-python-api-surface-gate.md) on 2026-08-23. **Q1.1 was a real bug and
worse than the question suggests** — it would have shipped a snapshot that recorded a quarter
of an exported Protocol's contract. The other three are correct and cheap.

**Q1.1 — accepted, and it is the most valuable finding in this review.** Verified against the
package, where it breaks in two different directions:

- **`JsonBodyResponse(TextResponse, Protocol)` defines only `json`.** Its `ok`, `status` and
  `text` are inherited from `TextResponse`. Under `vars(cls)` the snapshot would have recorded
  **one of its four members** — and the plan's own "renders at least one member" assertion
  would not have caught it, because one is not zero. A gate that silently drops three quarters
  of a Protocol's contract is worse than no gate, because it reads as coverage.
- **`UrlResolutionError` and `MissingEnvError` have empty bodies** — a docstring and nothing
  else. Under `vars(cls)` they render with *nothing*, so the plan as written would have
  **failed at Task 4 Step 4**. Their entire surface is which exception they subclass, which is
  exactly what a consumer writing `except ConnectorKitError` needs.

The fix has two halves, because either alone is insufficient. Members are now collected across
the **MRO**, and the class bullet **names its bases** — `class JsonBodyResponse(TextResponse,
Protocol)`, `class UrlResolutionError(ConnectorKitError)`.

The recommendation floated `inspect.classify_class_attrs`, which was not taken: it walks the
full MRO to `object`, so `HttpStatusError` would acquire `BaseException.args`,
`with_traceback` and `add_note`, and `JsonBodyResponse` would acquire `Protocol` and `Generic`
internals — none of it this package's surface, and all of it liable to churn the snapshot
whenever CPython changes. Instead the walk stops at the package boundary: a member counts only
if the class defining it has a `__module__` under `nimbus_sdk`, with `typing.Protocol` admitted
as a base because declaring it tells a consumer the type is structural. A test asserts those
three `BaseException` names never appear.

The weak assertion that permitted the bug is replaced by four that would have caught it:
inherited members are present by name, bullets name their bases, no class is described by name
alone, and no `object`/`Exception` internals leak in.

**Q1.2 — deferred, with the reason recorded where it will be needed.** PEP 695
(`type X = ...`) does produce an `ast.TypeAlias` rather than an `ast.Assign`, so
`alias_sources` would need a second branch. It cannot appear yet:
`requires-python = ">=3.11"` and ruff's `target-version = "py311"`, while PEP 695 is 3.12
syntax — a SyntaxError on the supported floor. Writing the branch now would be untestable
code for a shape the package cannot contain. The note lives in `alias_sources`'s docstring, so
whoever raises the Python floor finds it at the place that has to change rather than in a
review nobody re-reads.

**S2.1 — accepted.** `/tmp/nimbus-verify` was wrong for this host: `/tmp` resolves only inside
Git Bash on Windows, and it has already caused path trouble in this repository — an agent hit
it during the conformance work. The verification step now clones into the session scratchpad,
which every shell here can reach, and says why in one line so nobody "simplifies" it back.

**S2.2 — deferred, with the fallback behaviour stated.** Nothing in any of the four `__all__`
lists is a callable instance: the 67 names are functions, classes, three type aliases, and a
handful of constants (`CONTRACT_VERSIONS` a tuple, `IPC_MAX_LINE_BYTES` an int,
`CONTRACT_VERSION_PATTERN` an `re.Pattern`, which defines no `__call__`). If one ever lands it
classifies as `DATA` and renders as `NAME: type` — understated, but visible in the snapshot
and in review, not silent. Adding a `callable(obj)` branch today would be speculative
generality for a shape the package does not have, and the design's YAGNI stance is explicit.

**One knock-on beyond the findings.** Q1.1 changed Task 4's test plan and every downstream
count: the single weak class assertion became four, so the expected totals move from
15/18/21/25 to 18/21/24/28 across Tasks 4 through 6.

**What this review did not cover, recorded so the gap is visible.** All four findings concern
the generator's treatment of individual members. Nothing in it examines the gate itself —
whether the four assertions in Task 6 are the right four, or whether the roots-coverage check
actually catches a fifth import root — nor the falsification steps that are supposed to prove
each one can fail. That is where a wrong call produces a gate which passes while measuring
nothing, and it remains unreviewed.
