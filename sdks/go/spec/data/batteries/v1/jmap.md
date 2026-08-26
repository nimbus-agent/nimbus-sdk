# Nimbus JMAP battery contract v1

**Status:** normative. **Contract version:** `v1`.

This document specifies the `jmap` battery: the pure half of a JMAP mail client — session
parsing, request building, response extraction, and the reduction of a raw JMAP `Email` to a
JSON-safe view that carries headers, attachment metadata and a capped preview, and never a
full body or attachment bytes.

Read [`./README.md`](./README.md) first — its rules §R1–§R7 apply here and are not repeated.
The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as described
in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

The TypeScript reference implementation is
[`sdks/typescript/src/jmap-fastmail/index.ts`](https://github.com/nimbus-agent/nimbus-sdk/tree/main/sdks/typescript/src/jmap-fastmail/index.ts),
published from the `.` entry point. The executable form of this document is the corpus at
[`../../conformance/v1/jmap/`](../../conformance/v1/jmap/). Where prose and corpus appear to
disagree, the corpus is the tiebreaker.

## §1 Scope, and the name

This battery performs **no I/O**. Session discovery and the authenticated POSTs stay in the
caller; everything here takes a parsed value and returns one.

The protocol is [RFC 8620](https://www.rfc-editor.org/rfc/rfc8620) (JMAP core) and
[RFC 8621](https://www.rfc-editor.org/rfc/rfc8621) (JMAP Mail).

**This document and its corpus are named `jmap`; the modules are named `jmap-fastmail`,
`nimbus_sdk.jmap_fastmail` and `jmapfastmail`.** The mismatch is deliberate. Nothing
specified here is Fastmail-specific — `parseSession`, `viewEmail` and `validateApiUrl` are
plain JMAP operations against any conformant server — and a normative document is named for
what it specifies. The module names retain a vendor prefix for historical reasons and are not
renamed by this document. See
[RFC-0017 §2](../../../rfcs/0017-battery-specifications.md).

### §1.1 The scope constraint is a security property

These functions MUST NOT return attachment bytes or a full message body. `MAX_BODY_VALUE_BYTES`
bounds what is asked of the server; §6 bounds what is returned to the caller. A binding that
widens either does not conform, however useful the result.

## §2 Constants

Every one of these is part of the contract and MUST have the exact value given.

| Name | Value |
|---|---|
| `CORE_CAPABILITY` | `urn:ietf:params:jmap:core` |
| `MAIL_CAPABILITY` | `urn:ietf:params:jmap:mail` |
| `SUBMISSION_CAPABILITY` | `urn:ietf:params:jmap:submission` |
| `MAX_BODY_VALUE_BYTES` | `2048` |
| `PREVIEW_MAX_CHARS` | `2000` |

`EMAIL_PROPERTIES` is an ordered list, and its order is part of the contract because §7 emits
it into a request verbatim:

```
id, blobId, threadId, subject, from, to, cc, receivedAt,
sentAt, messageId, hasAttachment, preview, attachments,
textBody, bodyValues
```

`SUBMISSION_CAPABILITY` is published but is not referenced by anything in this document. It
is part of the surface for callers that send mail.

## §3 Two primitives

Every rule below is expressed in terms of these, and a binding MUST implement them with
exactly these semantics.

- **as-record(v)** — `v` when it is a non-null, non-array object; otherwise an absence. An
  array is **not** a record here, which is what stops a JSON array from being read as an
  object with numeric keys.
- **as-string(v)** — `v` when it is a string **and is not empty**; otherwise an absence.

The empty-string rule is the one that will be missed. Throughout this document, "absent" and
"present but empty" are the same condition for a string field. A binding whose `as_string`
returns `""` for an empty input will produce a `JmapSession` from a session document with
`"apiUrl": ""`, and then attempt to fetch it.

## §4 Session parsing

`parseSession(parsed)` returns a session, or an absence (§R6).

1. The value must be a record (§3), else absence.
2. `apiUrl` is as-string of the root's `apiUrl` member.
3. `accountId` is as-string of `primaryAccounts[MAIL_CAPABILITY]`, where `primaryAccounts` is
   as-record of the root's `primaryAccounts` member. If `primaryAccounts` is not a record, the
   account id is an absence.
4. If **either** is an absence, the result is an absence. Otherwise the session is
   `{ apiUrl, accountId }`.

A session is all-or-nothing: there is no partially-populated result.

## §5 API URL validation

`validateApiUrl(candidate, allowedBase)` guards the one value in this battery that is chosen
by a remote party. The session resource is server-controlled, so a spoofed or compromised
session response could otherwise point the authenticated, bearer-token-carrying POSTs at an
arbitrary host. This is the same class of hole
[`../../connector-kit/v1/url-resolution.md`](../../connector-kit/v1/url-resolution.md) exists
to close, reached by a different route.

The candidate is accepted only when **all** of:

1. `candidate` and `allowedBase` both parse as absolute URLs;
2. `candidate`'s scheme is exactly `https`;
3. `candidate`'s **host** — host name and port, as the URL's authority carries them — equals
   `allowedBase`'s host.

The return value on acceptance is the **re-serialised** candidate, not the input string. A
binding MUST return its own parser's serialisation, so that the value handed to a fetch is one
this function actually inspected.

### §5.1 This function raises; §R6 does not apply

Every other function in this battery returns an absence for input it cannot use.
`validateApiUrl` **raises** — and MUST.

The distinction is not stylistic. An absence here would be a value a caller could ignore, and
the one thing a caller must not do with a rejected `apiUrl` is carry on. Failing loudly is the
control; an absence would make forgetting to check it the default. §R6's rule covers
unparseable *data*; this is a refused *credential destination*.

The three rejection messages are contract text (§R5):

| Condition | Message |
|---|---|
| Either URL fails to parse | `JMAP apiUrl is not a valid absolute URL` |
| Scheme is not `https` | `JMAP apiUrl must use https` |
| Host mismatch | `JMAP apiUrl host '<candidate host>' does not match configured '<base host>'` |

They are evaluated in that order, so a non-`https` candidate on a mismatched host reports the
scheme.

### §5.2 Host, not origin — a narrower check than `url-resolution.md` §6

`url-resolution.md` §6 defines an origin as scheme, host and port together. **This function
compares host only**, and separately requires the *candidate* to be `https` while placing no
scheme requirement on the base.

The consequences are real and are specified as they stand:

- An `allowedBase` of `http://api.example.com` accepts a candidate of
  `https://api.example.com`. Under an origin comparison it would not.
- Case and userinfo are handled by the URL parser's own `host` accessor rather than by §6's
  explicit lowercasing and last-`@` rule, so a binding MUST use a parser that normalises them
  the same way — §6's rules are the specification of what "the same way" means.

This is pinned rather than corrected because the check is *tighter* than an origin comparison
in the direction that matters: the candidate must be `https`, so the token cannot be sent in
clear text regardless of how the base was configured. Widening it to a full origin comparison
would newly reject an `http` base, which is a behaviour change to a `stable` module in the
direction of breaking working callers.

A binding MUST NOT substitute `resolveUrlWithBase` here. The two functions have different
signatures, different verdicts and different failure modes, and swapping one for the other
would change which sessions are accepted.

## §6 The email view

`viewEmail(raw)` reduces a raw JMAP `Email` to a view, or an absence.

The value must be a record (§3), else absence. Then:

| Member | Derivation |
|---|---|
| `id` | as-string of `id`, or the **empty string** if absent |
| `messageId` | as-string of `messageId[0]` when `messageId` is an array; otherwise absent |
| `subject` | as-string of `subject` |
| `from`, `to`, `cc` | §6.1 applied to the corresponding member |
| `receivedAt` | as-string of `receivedAt` |
| `attachments` | §6.2 applied to `attachments` |
| `preview` | §6.3 |

**The record is rejected only when `id` and `messageId` are both absent.** If exactly one is
present the view is returned, and if `id` was the absent one then `id` is the empty string —
the one place in this battery where an absence becomes `""` rather than the reverse. A binding
MUST reproduce this rather than rejecting a record with no `id`.

### §6.1 Addresses

Formatting one JMAP `EmailAddress`:

- a value that is not a record formats as the empty string;
- `email` is as-string of the `email` member, or the empty string;
- `name` is as-string of the `name` member;
- if `name` is present, the result is `name` when `email` is empty, and `<name> <<email>>` —
  that is, the name, a space, and the email in angle brackets — otherwise;
- if `name` is absent, the result is `email`.

Formatting a list: a value that is not an array yields an empty list; otherwise each element
is formatted and **empty results are dropped**. So a `from` array of three malformed entries
yields an empty list, not three empty strings.

### §6.2 Attachment metadata

A value that is not an array yields an empty list. Otherwise **one entry per element**,
including elements that are not records — those yield an entry with every member absent.
Attachment entries are never dropped, so the returned list's length always equals the input
array's length, and a caller can rely on positional correspondence.

Per element: `name` is as-string of `name`; `mimeType` is as-string of **`type`** — the JMAP
member is `type`, the view member is `mimeType`; `sizeBytes` is `size` when it is a finite
number, else absent. `NaN` and both infinities are absent, not zero.

### §6.3 The preview

`previewFor(raw)` prefers the first usable text-body part and falls back to the server's own
preview string:

1. If `bodyValues` is a record **and** `textBody` is an array, walk `textBody` in order. For
   each element, take as-record of it, then its `partId`; if that is a string, look up
   `bodyValues[partId]`, take as-record of it, then its `value`. The first element whose
   `value` is a non-empty string wins, and the result is that value capped per §6.4.
2. Otherwise the result is as-string of `preview`, or the empty string, capped per §6.4.

`preview` is therefore never absent — it is the empty string when nothing is available.

### §6.4 Capping

Capping normalises then truncates, in this order:

1. every `\r\n` becomes `\n`;
2. every run of one or more spaces or tabs becomes a single space;
3. every run of two or more newlines becomes a single newline;
4. the result is trimmed per §R7;
5. if it is longer than `PREVIEW_MAX_CHARS` (2000), it is truncated to that length.

Step 5's length is measured in the same units the binding's string type counts, and truncation
MUST NOT split a code point. A binding whose string is a byte sequence measures code points
here, not bytes; this differs from `icalendar` §7.1, which measures octets because RFC 5545
does.

## §7 Request builders

Per §R5 the built structures are pinned exactly, including key order where the binding's
serialisation preserves it (see §9).

### §7.1 Shared `Email/get` arguments

```
accountId:            <accountId>
<ids reference>:      supplied by the caller — either `ids` or `#ids`
properties:           EMAIL_PROPERTIES, in order
fetchTextBodyValues:  true
maxBodyValueBytes:    MAX_BODY_VALUE_BYTES
bodyProperties:       ["partId", "blobId", "size", "name", "type", "disposition"]
```

### §7.2 List and search

Both are one request containing **two** method calls: an `Email/query` whose client id is
`"q"`, then an `Email/get` that back-references it. They differ only in the query's `filter`.

```
using:        [CORE_CAPABILITY, MAIL_CAPABILITY]
methodCalls:
  - ["Email/query", {
        accountId,
        filter: { text: <query> }      -- search only; omitted entirely for list
        sort: [{ property: "receivedAt", isAscending: false }],
        collapseThreads: false,
        limit: <limit>
     }, "q"]
  - ["Email/get", <§7.1 args with "#ids": { resultOf: "q", name: "Email/query", path: "/ids" }>, "e"]
```

Three requirements:

- **The list form omits `filter` entirely**; it does not send a null or an empty object.
- **`"q"` appears twice** — as the query's client id and as the get's `resultOf` — and the two
  MUST agree. A mismatch produces an unresolved-reference error from the server at runtime,
  against a live account, which is the worst place to discover it.
- The back-reference means one round trip, not two. A binding MUST NOT issue the get
  separately.

### §7.3 Get by id

```
using:        [CORE_CAPABILITY, MAIL_CAPABILITY]
methodCalls:  [["Email/get", <§7.1 args with ids: [<id>]>, "e"]]
```

## §8 Response extraction

- `methodResponseArgs(parsed, methodName)` — take as-record of `parsed`, then its
  `methodResponses`. If that is not an array, absence. Otherwise scan **in order** for the
  first element that is an array whose first item equals `methodName`, and return as-record of
  that element's second item. No match, or a second item that is not a record, yields an
  absence.
- `extractEmailList(parsed)` — the `list` member of `methodResponseArgs(parsed, "Email/get")`,
  when that is an array; otherwise an empty list.

Both tolerate a partially-shaped envelope without raising (§R6). A JMAP error response, which
carries a method name of `error`, simply produces no match.

## §9 Divergences a binding must handle

**Object key order in built requests.** §7's structures are specified as maps, and Go's
`encoding/json` sorts a map's keys on marshal where JavaScript and Python emit insertion
order. JMAP is JSON-RPC-shaped and servers do not depend on member order, so this does not
affect correctness against a server — but it **does** mean a corpus case cannot compare
serialised bytes across bindings. Cases for §7 MUST compare the parsed structure, not the
string. This is the same hazard recorded for `connector-kit` in
[`docs/modules/connector-kit.md`](../../../modules/connector-kit.md).

**`methodCalls` entries are heterogeneous arrays** — string, object, string. A binding whose
JSON encoder requires homogeneous lists must model them explicitly rather than reaching for a
typed struct.

**Numbers.** `limit` and `MAX_BODY_VALUE_BYTES` are small integers. `size` in §6.2 is
whatever the server sent; a binding MUST treat a non-finite or non-numeric value as absent
rather than coercing it to zero.
