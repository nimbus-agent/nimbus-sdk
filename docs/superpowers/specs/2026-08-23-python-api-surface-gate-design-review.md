# Review & Feedback: Python API-surface Gate Design

**Date:** 2026-08-23  
**Design Reference:** [2026-08-23-python-api-surface-gate-design.md](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/python-api-surface/docs/superpowers/specs/2026-08-23-python-api-surface-gate-design.md)

---

## 1. Open Questions

### Q1.1: Signature Serialization across Python Versions
*   **Context:** The design mentions that the gate will run in CI on all four supported Python versions. The generator uses `inspect.signature` to serialize callable signatures.
*   **Question:** Python versions can format type annotations and signatures differently under dynamic inspection (e.g., `typing.Sequence` vs `collections.abc.Sequence` or union formats like `|` vs `Union`). How will we prevent the generator output from varying across Python versions, which would cause false-positive test failures?
*   **Recommendation:** Clarify if the signature rendering logic will normalize types (e.g., by converting standard typing forms, stripping namespace paths, or standardizing `Union`/`Optional` representations). Alternatively, specify that the snapshot is generated using a specific *canonical* Python version (e.g., the latest supported version) to ensure consistency, while the gate test on other versions verifies structure or operates on normalized comparisons.

### Q1.2: Treatment of Public Magic (Dunder) Methods
*   **Context:** The design states: *"Underscore-prefixed members are omitted; they are not surface."*
*   **Question:** How should special double-underscore methods (dunders) that are critical to a class's public interface be treated? For example, `__init__` (defines class instantiation arguments), `__call__` (defines callability), and `__enter__`/`__exit__` (defines context manager usage) are key elements of a class's public contract. Omitting them completely hides this API surface.
*   **Recommendation:** Explicitly define a whitelist of public dunder methods (such as `__init__`, `__call__`, `__enter__`, `__exit__`, `__getitem__`, `__setitem__`) to be captured in the snapshot under class definitions, while continuing to omit standard representation or comparison dunders (like `__repr__`, `__str__`, `__eq__`) and single-underscore private methods.

### Q1.3: Class Properties and Attributes
*   **Context:** The design describes representing **Classes** with public methods indented beneath as `def` bullets, and **Data** as `NAME: type`.
*   **Question:** How should properties (defined via `@property`) and class attributes be documented inside a class section? Since properties behave as data but are implemented as methods, should they render as `def name(self) -> type` or as attributes `name: type` under the class?
*   **Recommendation:** Clarify the representation of properties in the snapshot. Representing them as attributes (e.g., `name: type` or `@property name: type`) aligns with their consumer usage pattern and keeps the class API representation concise.

---

## 2. Technical Suggestions & Improvements

### S2.1: Resolving Stringified Annotations (`from __future__ import annotations`)
*   **Context:** Modules using `from __future__ import annotations` store annotations as strings at runtime.
*   **Suggestion:** When using `inspect.signature`, call it with `eval_str=True` (available in Python 3.10+) or use `typing.get_type_hints()` to resolve forward-references. This ensures annotations are consistently rendered as actual type names rather than literal string representations.

### S2.2: Signature Fallback for Decorated or Built-in Callables
*   **Context:** The Risks section notes that `inspect.signature` can raise `ValueError` on C-implemented or decorated objects.
*   **Suggestion:** Use `inspect.unwrap` before inspecting signatures to resolve decorators. If `ValueError` is still raised, catch the error and output a safe fallback signature (e.g., `def name(*args, **kwargs)  # signature unavailable`) or log a warning, rather than letting the entire generation process fail.

### S2.3: Standardizing the Regeneration Command
*   **Context:** The design mentions adding the regeneration command to the file header and `CLAUDE.md`.
*   **Suggestion:** Ensure that the generation script resolves paths relative to the git repository root, so that the command can be run consistently from anywhere in the codebase (e.g., `python sdks/python/scripts/api_surface.py` or through a standard task runner).

---

## 3. Disposition

All three questions applied to
[the design](./2026-08-23-python-api-surface-gate-design.md) on 2026-08-23. Two of the three
suggestions applied; **one is rejected because it would have caused the exact failure Q1.1
warns about**. Every finding was checked against the package rather than reasoned about
abstractly.

**Q1.1 — the risk is real in general and already neutralised here, but the design never said
so, which is a defect in the document.** Verified: **every** file under
`src/nimbus_sdk/` begins with `from __future__ import annotations` — the check
`grep -rL` returns an empty list. Under that pragma annotations are never evaluated; they are
retained as the literal strings written in the source, so `inspect.signature` reports
`Sequence[str]` because that is the text in the file, identically on 3.11 and 3.14. The
design now carries a **Version stability** section stating this, and — because the property is
load-bearing rather than incidental — a test asserts the pragma is present in every file, so
a module that omits it fails as itself rather than as a mysterious per-version golden
mismatch on some CI legs and not others.

**S2.1 — rejected, and it directly contradicts Q1.1.** The suggestion is to resolve
stringified annotations with `eval_str=True` or `typing.get_type_hints`. Both convert those
stable source strings into runtime objects whose `repr` is *precisely* what differs between
versions — `typing.Optional[str]` against `str | None`, `typing.Sequence` against
`collections.abc.Sequence`. Adopting S2.1 would manufacture the cross-version instability
Q1.1 asks how to avoid. The design now names both functions as forbidden and says why, so the
next reader does not re-derive the idea and reintroduce the bug. Recording the annotations
*as written* is also the more useful diff: it moves when an author changes a signature, not
when CPython changes how it prints one.

**Q1.2 — accepted, with a different mechanism than the recommended one.** The finding is
right that omitting all dunders hides real surface, and understates it: `contract.py` and
`diagnostics/event.py` declare their exported types as `@dataclass(frozen=True, slots=True)`,
so the constructor is the class's entire public shape. The recommendation was a whitelist of
interesting dunders. Rejected in favour of naming the source of truth: a dataclass's **fields**
are the surface, and `__init__` is derived from them, so fields render from
`dataclasses.fields()`. A hand-written `__init__` — `HttpStatusError` has one at
`errors.py:37` — renders as itself. No other dunder is recorded, because a whitelist of
"interesting" ones is a list nobody maintains; the day an exported class needs `__enter__` or
`__call__`, that is a decision to take with the export in front of you.

**Q1.3 — accepted, and it is more serious than the question suggests.** Properties are not a
hypothetical corner: `TextResponse` and `JsonBodyResponse` are **exported** (both appear in
`connector_kit`'s `__all__`) `Protocol`s whose **entire contract is `@property`** — `ok`,
`status`, `text`, `json`. Under the design as written they would each have rendered as
`class TextResponse` with nothing beneath: a class recorded, none of its surface recorded.
The recommendation to render properties as attributes is adopted for the reason it gives —
`ok: bool` is how a consumer uses it, where `def ok(self) -> bool` describes the
implementation instead of the interface.

**S2.2 — half accepted.** `inspect.unwrap` before inspecting costs nothing and is now
specified. The fallback bullet is rejected: a placeholder such as
`def name(*args, **kwargs)  # signature unavailable` records *less* surface while still
matching a committed golden, so every later change to that export's real signature would pass
silently — the gate would keep reporting a coverage it no longer has. The generator fails and
names the export instead. Same reasoning that makes an empty report a failure rather than an
absence in the conformance reconciler.

**S2.3 — already specified, now confirmed.** The design's *Two roots, again* section already
requires the generator to resolve the repository root once from its own `__file__` and expose
it as a module constant, precisely so the command works from any directory. No change.

**One knock-on beyond the findings.** Q1.2 and Q1.3 changed the test plan. The renderer's
synthetic module was specified as "a function, a class with public and private methods, a
constant"; it now must also carry a frozen dataclass, a `Protocol` of properties, and a
hand-written `__init__` — every shape that exists in the real surface — because a format
pinned only against shapes the package does not contain pins nothing that matters.

**What this review did not cover, recorded so the gap is visible.** All three questions
concern how individual members render. Nothing in it examines the design's load-bearing
choice — runtime introspection over static AST parsing — or the roots-coverage assertion,
which is the only check that can catch a fifth import root landing undocumented. Those remain
unreviewed.
