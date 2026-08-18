# Review & Suggestions: Python `connector-kit` Shipment 1 Plan

This review document provides feedback, open questions, and improvements on the implementation plan defined in [2026-08-18-python-connector-kit-shipment-1.md](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/python-connector-kit/docs/superpowers/plans/2026-08-18-python-connector-kit-shipment-1.md).

---

## 1. Type Annotation Assertions in Unit Tests

In **Task 6: `env.py`** (Step 1), the unit test:
```python
def test_the_seam_is_read_only_by_annotation() -> None:
    # Mapping, not MutableMapping: a helper whose job is reading the environment must not
    # hand callers a seam that invites writing to it.
    assert os.environ.get("PATH") is not None
```
### Observation
This test does not actually verify that the type annotation of the `env` parameter in `require_env` is `Mapping` rather than `MutableMapping`. It simply asserts that the `PATH` environment variable exists in `os.environ` at runtime.

### Suggestion
Since type annotations are not enforced at runtime by pytest, we should clarify in the test docstring or inline comments that this is statically checked via `mypy` rather than this runtime assertion. If we want a runtime assertion to verify that `require_env` does not accept type mutations or that the default object isn't copied/mutated, we can assert that mutating the default or checked mapping is prevented or that type checking fails under mypy.

---

## 2. Protocol-Relative URL Resolution (e.g., `//evil.com/x`)

In **Task 1: RFC-0011** and **Task 2 / Task 4**, the absoluteness heuristic check is defined as:
```ts
const ABSOLUTE_URL = /^[A-Za-z][A-Za-z0-9+.-]*:/;
```
### Observation
A protocol-relative URL like `//evil.com/x` has no scheme prefix and no colon before the first slash, so it will fail this regex and be treated as a **relative** path.
- Under §4, it will resolve as `base + input` (e.g., `https://api.example.com` + `//evil.com/x` = `https://api.example.com//evil.com/x`).
- Since the resulting string begins with `https://api.example.com`, standard fetches will direct the request to `api.example.com` (treating `//evil.com/x` as a path segment with an empty subdirectory name).
- However, if the client or underlying library normalizes paths or processes them via native WHATWG parsing before prefixing (e.g., `new URL("//evil.com/x", "https://api.example.com")`), it could resolve directly to `https://evil.com/x`.

### Suggestion
Ensure the conformance suite has a test case pinning the behavior of protocol-relative inputs (e.g., `//evil.com/x`) to guarantee that they are treated as path segments (concatenated) rather than resolved to the target host.

---

## 3. Case-Folding Differences (`lower()` vs `toLowerCase()`)

The plan mentions case-folding compatibility for `İstanbul` (U+0130) folding to `i̇` (i + U+0307 combining dot).

### Observation
Depending on the Python runtime version, OS locale, and underlying Unicode database, `lower()` on `İ` can behave differently. For example, on some interpreters, `"İstanbul".lower()` yields `"istanbul"` (plain ASCII `i`), whereas in JS `"İstanbul".toLowerCase()` yields `"i\u0307stanbul"`.

### Suggestion
Add an explicit validation step in the Python test suite to print the exact byte/unicode representation of `"İstanbul".lower()` vs JavaScript's expected output to avoid local false-positives or environment-specific failures.

---

## 4. `HttpStatusError` and Non-Text Payloads
In **Task 7: `types.py` and `results.py`**, `HttpStatusError` takes `res.text[:snippet_max]`.

### Question
What happens when the non-2xx response has a binary payload or contains raw/corrupted bytes that cannot be decoded as UTF-8 text? 
- Will the underlying transport handle the text decoding gracefully (e.g. replacing invalid chars), or will accessing `res.text` raise a `UnicodeDecodeError`?
- It is recommended that `res.text` fallback gracefully to an empty string `""` or hex snippet if decoding fails, ensuring that `HttpStatusError` is successfully raised instead of crashing on a decode error.

---

## 5. Resolutions

Applied to [2026-08-18-python-connector-kit-shipment-1.md](./2026-08-18-python-connector-kit-shipment-1.md).
Four items: two accepted as written, one accepted with its premise corrected and its
conclusion strengthened, one deferred to Shipment 2 with the requirement recorded.
Nothing was dismissed.

| Item | Verdict | Landed in |
| --- | --- | --- |
| 1 — the annotation test asserts nothing | Fixed | Task 6, Step 1 |
| 2 — protocol-relative URLs | Fixed, and it was worse than described | The rule / Tasks 1, 2, 3, 4 |
| 3 — case-folding variance | Measured; premise corrected | Task 8, Steps 1 and 5 |
| 4 — undecodable `res.text` | Deferred, requirement recorded | *Carried to Shipment 2*, item 1 |

### 1 — the annotation test · fixed

Correct: `assert os.environ.get("PATH") is not None` verifies that `PATH` is set, and
nothing about `require_env`'s signature. It was a test that could never fail for the
reason it claimed to exist.

Replaced with two that do carry weight. `test_an_immutable_mapping_is_an_acceptable_seam`
passes a `MappingProxyType`, which has no `__setitem__` at all — it is the runtime half of
the `Mapping`-not-`MutableMapping` claim, and the half that would actually break a caller
if the parameter type were widened. `test_reading_the_environment_never_writes_to_it`
asserts the supplied mapping is unchanged after both a hit and a miss, which is what stops
`setdefault`-shaped code from landing later. The annotation itself stays a `mypy --strict`
concern, and the comment now says so instead of implying pytest checks it.

### 2 — protocol-relative URLs · fixed, and the risk is larger than the review states

The review frames the danger conditionally — *"if the client or underlying library
normalizes paths"*. Measured, it is not conditional, and the vulnerable party is this
repository's own next binding rather than a downstream client:

```
"https://api.example.com" + "//evil.com/x"                 -> https://api.example.com//evil.com/x   (host api.example.com)
urljoin("https://api.example.com", "//evil.com/x")         -> https://evil.com/x                    (host evil.com)
```

Both were run on CPython 3.14.6. `urljoin` is the one-line way anyone naturally writes
"resolve a relative path", and §4 as originally drafted said "resolve", which invites it.
A binding that reaches for it hands a caller-supplied string a *network-authority
reference* pointing at another host — and because a protocol-relative input has no scheme,
§3 classifies it as relative, so it never reaches the origin check that exists to catch
exactly this. §4 is therefore the only branch where a wrong implementation exfiltrates the
bearer token with nothing in the design able to stop it.

Four changes, not the one case the review asks for:

1. §4 is restated as a **MUST NOT**: concatenation, never RFC 3986 relative-reference
   resolution, naming `urllib.parse.urljoin` and `new URL(input, base)` as the specific
   wrong constructs and carrying both measured outputs.
2. A corpus case, `cases/protocol-relative-is-a-path.json`, so both bindings execute it —
   twenty cases became twenty-one, and every count in the plan moved with it.
3. Unit tests in both languages, each asserting the resolved host as well as the string,
   with the Python one additionally pinning `urljoin`'s output so the trap is visible in
   the file that avoids it.
4. A guard assertion, `§4 is pinned against relative-reference resolution`, which fails if
   no case supplies a `//`-prefixed input. Without it this case is the one a future tidy-up
   deletes as redundant: every *other* relative case resolves identically under both
   readings, so nothing else would go red.

### 3 — case-folding · measured, and the premise corrected

The caution is right and is now discharged by measurement rather than by instruction. The
stated mechanism is not:

- **`str.lower()` is not locale-sensitive in Python 3.** It is driven by the compiled
  Unicode database, not by `LC_CTYPE`. A disagreement between machines means a UCD version
  difference worth naming, not an environment quirk to code around.
- **`"İstanbul".lower()` does not yield ASCII `"istanbul"` on any current interpreter.**
  Measured on CPython 3.14.6 / UCD 16.0.0 and Node 24.18.1, `lower()`, `casefold()` and
  `toLowerCase()` all return `U+0069 U+0307` — all three agree.

That last point changes what the İ test is *for*. The plan inherited from the design the
idea that `ß` and `İ` are both `lower`-versus-`casefold` discriminators; only `ß` is
(`lower` keeps `U+00DF`, `casefold` yields `ss`). `İ` is a **cross-binding parity pin** —
its fold expands one code point into two, which is where a byte-wise or
single-code-point fold breaks — and the test comment now says that rather than the wrong
thing. A companion assertion that the bare ASCII `"istanbul"` does **not** match was added,
without which the İ test passes on substring luck rather than on the fold.

The measured table is in the plan at the point of use, and Task 8's step now says a
failure is a finding to record, not a literal to adjust.

### 4 — undecodable `res.text` · deferred, requirement recorded

Right, and out of scope here: `results.py` takes a `TextResponse` whose `text` is already a
`str`, so nothing in Shipment 1 ever holds bytes. The question is entirely about
`UrllibTransport`, which is Shipment 2.

It is worth more than a deferral note, because the failure mode is nastier than "a decode
error": a non-2xx body is exactly where a server is most likely to return something that is
not valid UTF-8 — a proxy error page, a truncated gzip, a binary blob — so a strictly
decoding transport dies with `UnicodeDecodeError` on the error path and `HttpStatusError`
is never raised at all. The status code is lost in the one case a caller most needs it.

Recorded as item 1 of the plan's new *Carried to Shipment 2* section: `UrllibTransport`
MUST decode with `errors="replace"`, tested against the real `http.server` fixture rather
than a fake — a fake transport hands back a `str` and cannot see the bug.

The review's own suggestion of an empty-string fallback is declined: `""` discards the
snippet entirely, and the snippet is the only diagnostic content `HttpStatusError` carries.
`errors="replace"` keeps whatever was decodable and marks the rest.
