# Nimbus MCP server layer contract v1

**Status:** normative. **Contract version:** `v1`.

This document specifies the MCP server layer: what a server built on it answers, message for
message, to a client of the Model Context Protocol over stdio. The layer serves two protocol
eras from one process: the stateless revision `2026-07-28`, and the `initialize` handshake of
`2025-11-25` and the three revisions before it.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as described
in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

The TypeScript reference implementation is
[`sdks/typescript/src/mcp-server/`](https://github.com/nimbus-agent/nimbus-sdk/tree/main/sdks/typescript/src/mcp-server),
published from the `./mcp-server` entry point. The executable form of this document is the
corpus at [`../../conformance/v1/mcp-server/`](../../conformance/v1/mcp-server/). Where prose
and corpus appear to disagree, the corpus is the tiebreaker.

This contract is implemented by the TypeScript binding only. It concerns a TypeScript process:
the Nimbus CLI's MCP adapter and the first-party connectors. [RFC-0021](../../../rfcs/0021-mcp-server-layer.md)
records that decision and the alternatives.

**What is the Model Context Protocol's and what is ours.** The wire shapes below are the
protocol's, read from its published specification on 2026-11-15. Where that specification leaves
a server's behaviour open, this document chooses, and marks the choice **OURS**. Revision
`2026-07-28` is the protocol's *current* revision, not a final one: it may gain backwards
compatible changes, and this document pins what was read on that date.

## §1 Scope

A server is a name, a version, an optional title, optional instructions and a set of tools. A
**connection** is one client's stream of JSON-RPC 2.0 messages and the server's replies to it.

In scope: the stdio transport, and tools (`tools/list`, `tools/call`). Out of scope, and answered
as an unknown method (§4, §5): resources, prompts, sampling, roots, tasks, subscriptions, logging
and progress. An MCP client, and the HTTP transport, are not specified here.

A tool has a `name`, a `description`, an `inputSchema` (a JSON Schema object), and optionally a
`title` and `annotations`. The layer sends `inputSchema` to the client and MUST NOT validate a
call's arguments against it: a handler receives the arguments exactly as the client sent them.

Versions. `2026-07-28` is the **modern** version. `2025-11-25`, `2025-06-18`, `2025-03-26` and
`2024-11-05` are the **legacy** versions, newest first.

## §2 Messages that are not requests

A message is one JSON value. The layer classifies it before anything else, in this order:

1. A value that is not a JSON object (a number, a string, `null`, an array, so a JSON-RPC batch
   too) MUST be answered with error `-32600`, `id: null`.
2. An object with no string `method`:
   - with an `id` member it is a **response**. It MUST NOT be answered, whatever its `id`
     (**OURS**: a late or unknown response is dropped, never answered with an error);
   - with no `id` member it MUST be answered with error `-32600`, `id: null`.
3. An object with a string `method` and no `id` member is a **notification**. It MUST NOT be
   answered. `notifications/cancelled` cancels the request its `params.requestId` names (§6);
   every other notification, `notifications/initialized` included, is ignored.
4. An object with a string `method` and an `id` that is neither a string nor a finite number
   MUST be answered with error `-32600`, `id: null`.
5. Anything else is a **request**.

Only a request decides the era (§3). The messages of items 1 to 4 never do.

## §3 The era latch

A connection is in exactly one era, **modern** or **legacy**. The era is decided by the FIRST
request the connection receives, whatever is then answered to that request, and it never changes
(**OURS**: the protocol lets one process serve both eras at once; one era per connection means
a legacy server-to-client request can never reach a client that did not open with `initialize`,
and a client cannot move a connection between eras).

A request **carries the modern version** when its `params` is an object whose `_meta` is an
object with a member named `io.modelcontextprotocol/protocolVersion`.

- The first request's method is `initialize`, it does not carry the modern version, and the
  server serves the legacy era: the connection is **legacy**.
- Every other first request makes the connection **modern**.

A server MAY be started so that it refuses the legacy era. On such a server every connection is
modern.

After the latch:

- On a modern connection, `initialize` MUST be answered with error `-32601`. One exception: when
  it is the connection's first request, does not carry the modern version, and the server refuses
  the legacy era, it MUST be answered with error `-32022` whose `data.supported` is
  `["2026-07-28"]` and whose `data.requested` is the request's `params.protocolVersion` (the empty
  string when that is not a string).
- On a legacy connection, a request's `_meta` is ignored.

## §4 The modern era

Every request on a modern connection is checked on its own, in this order, before its method is
looked at (except `initialize`, §3):

1. It does not carry the modern version: error `-32602`.
2. The version is not a string: error `-32602`.
3. `_meta["io.modelcontextprotocol/clientCapabilities"]` is absent or not an object: error
   `-32602`.
4. The version is not `2026-07-28`: error `-32022`, `message` `Unsupported protocol version`,
   `data.supported` = `2026-07-28` followed by the legacy versions newest first (only
   `2026-07-28` on a server that refuses the legacy era), `data.requested` = the version.

Every result on a modern connection MUST carry `resultType: "complete"` and
`_meta["io.modelcontextprotocol/serverInfo"]` = the server's `name`, `version` and, when it has
one, `title`.

- `server/discover`: `supportedVersions: ["2026-07-28"]` (the only version a request's `_meta`
  can name), `capabilities: { "tools": {} }`, `instructions` when the server has them,
  `ttlMs: 3600000`, `cacheScope: "public"`.
- `tools/list`: `tools` (each tool's `name`, `title` when present, `description`, `inputSchema`,
  `annotations` when present, in that order), `ttlMs` and `cacheScope`. The defaults are `0` and
  `"private"` (**OURS**: a tool set may follow state outside the process). The list is not
  paginated: `cursor` is ignored and no `nextCursor` is sent.
- `tools/call`: §6.
- Every other method, `ping` and `logging/setLevel` included (both removed from this revision):
  error `-32601`.

## §5 The legacy era

A legacy result carries neither `resultType` nor `_meta`.

- `initialize`: when `params.protocolVersion` is not a string, error `-32602`. Otherwise the
  result's `protocolVersion` is the requested version when it is a legacy version, else
  `2025-11-25` (never `2026-07-28`, which has no handshake); `capabilities: { "tools": {} }`;
  `serverInfo`; `instructions` when the server has them. The client's `clientInfo` and
  `capabilities` are kept for the connection. A later `initialize` is answered the same way and
  replaces them.
- `ping`: the empty result `{}`.
- `tools/list`: `tools`, as in §4, and nothing else.
- `tools/call`: §6. Before any `initialize` has succeeded on the connection it MUST be answered
  with error `-32601`.
- Every other method, `server/discover` included: error `-32601`.

## §6 Tool calls

In both eras:

1. `params.name` is not a string: error `-32602`.
2. No tool has that name: error `-32602`.
3. The handler runs with `params.arguments`, or the empty object when that member is absent.

The result is the handler's `content`, its `structuredContent` when that is an object, and
`isError: true` when the handler set it. On a modern connection the envelope of §4 is added.

A handler's failure is a RESULT, not a JSON-RPC error, so that the model sees it:

- A failure the handler declares with a message of its choosing: `content` is one text block
  holding that message, `isError: true`.
- Any other failure, and a returned value that has no `content` array: `content` is one text
  block holding `Tool failed`, `isError: true`. The failure's own message MUST NOT be sent: it
  can hold a path or a secret.

When the tool set itself cannot be read, `tools/list` and `tools/call` MUST be answered with
error `-32603` and a fixed message.

Cancellation. `notifications/cancelled` whose `params.requestId` equals a running call's `id`
(same JSON type and value: the string `"7"` does not name the number `7`) cancels that call. A
cancelled call MUST NOT be answered.

## §7 The stdio transport

One message per line, UTF-8, each line ended by a newline; a message never contains a newline.
The server MUST NOT write anything but MCP messages to its output.

- A line that is not JSON MUST be answered with error `-32700`, `id: null`, and the connection
  continues.
- A line is delivered when its newline arrives, however the bytes were split across reads.
- A line longer than the SDK's line limit (1 MiB) MUST be answered with error `-32600`,
  `id: null`, and ends the connection: after such a line the next message boundary cannot be
  trusted (**OURS**).
- Requests are handled concurrently: a server MUST NOT wait for one request's answer before it
  reads the next message, and it MAY send the answers to different requests in any order. A
  client matches an answer to its request by `id`.
- When the input ends, calls already accepted finish and are answered before the server stops.

## §8 Error codes

| Code | Meaning here |
| --- | --- |
| `-32700` | A line that is not JSON (§7) |
| `-32600` | Not a JSON-RPC request, response or notification (§2); a line over the limit (§7) |
| `-32601` | A method this era does not have (§3, §4, §5) |
| `-32602` | A request missing what its era requires (§4, §5); a bad tool name (§6); a request state that fails verification (§11) |
| `-32603` | The tool set cannot be read (§6) |
| `-32022` | A protocol version the server does not serve (§3, §4) |

An error's `message` is informative, except `Unsupported protocol version`, which the protocol
fixes. A conforming implementation is compared on `code` and `data`.

## §9 The conformance fixture

The corpus runs against one fixed server so that a case is data and nothing else:

- name `conformance-server`, version `1.0.0`, no title; `instructions` only where a case's
  `server.instructions` gives them;
- tool `echo` (title `Echo`, description `Returns its arguments`, input schema
  `{"type":"object"}`, annotations `{"readOnlyHint":true}`): returns one text block holding the
  JSON serialization of its arguments, and the arguments as `structuredContent` when they are an
  object;
- tool `declared-failure` (description `Fails with a chosen message`, input schema
  `{"type":"object"}`): fails with the declared message `The record is locked`;
- tool `unexpected-failure` (description `Fails unexpectedly`, input schema `{"type":"object"}`):
  fails with an undeclared error whose message is `ENOENT /home/alice/.ssh/id_rsa`;
- tool `wait` (description `Waits until cancelled`, input schema `{"type":"object"}`): does not
  return until its call is cancelled;
- tool `ask` (description `Asks the client to confirm`, input schema `{"type":"object"}`): when
  the call carries no input responses it asks for input (§10) with one request, key `confirm`,
  a form-mode `elicitation/create` with message `Proceed?` and requested schema
  `{"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"]}`, and the
  request state `state-1`; when it carries them it returns one text block holding the JSON
  serialization of the two-element array of the responses and the request state (`null` when
  there is none);
- tool `ask-url` (description `Asks the client to open a page`, input schema
  `{"type":"object"}`): always asks for input with one request, key `open`, a url-mode
  `elicitation/create` with message `Open the page` and url `https://example.com/confirm`, and
  no request state;
- tool `ask-nothing` (description `Asks for input without asking anything`, input schema
  `{"type":"object"}`): asks for input with no requests and no request state.

An `exchange` case gives the client's messages in order; each is delivered after the previous
one has been fully handled, unless the case is `concurrent`, in which case all are delivered
before any is awaited. A `stdio` case gives the raw chunks written to the server's input. Either
way `expect` is the exact list of messages the server sends, compared as JSON values: in order
for an `exchange` case, and as a set for a `stdio` case (§7 lets answers to different requests
arrive in any order; no `stdio` case expects two messages with the same `id`),
with one allowance from §8: an error's `message` is compared only for code `-32022`, and an
expected error otherwise carries no `message`.

An `exchange` case may carry `clientReplies`: how the client answers a request the SERVER sends
it (§10, legacy era), keyed by that request's `id`. The answer is delivered as soon as the
request is sent. A request with no entry is never answered.

A `digest`, `seal` or `open` case is one call into the functions of §11 and its `expect` is one
object: `{"digest"}`, `{"sealed"}`, and `{"payload"}` or `{"reason"}`. `key` is hex and `now`
is the clock in milliseconds; the request digest of a `seal` or `open` case is that of its `tool`
and `arguments`.

## §10 Input requests

A tool handler MAY, instead of a result, ask the client for input: a map of requests keyed by
names the handler chooses, an opaque request state, or both. `elicitation/create` is the only
request this layer sends.

Before anything is sent, in both eras:

- An input request with no requests and no request state MUST be answered as a tool error
  (`isError: true`, §6) with the text `An input request must carry inputRequests or requestState`.
- A server MUST NOT ask for what the client did not declare. A form-mode request (`params.mode`
  absent or `form`) needs the client capability `elicitation.form`, or an `elicitation` object
  with no members, which is how the revisions before `2025-11-25` declared form support. A
  url-mode request needs `elicitation.url`. Otherwise the call MUST be answered as a tool error
  with the text `This client cannot be asked for input`, and nothing is sent to the client.

**Modern era.** The call is answered with the protocol's interim result: `resultType` is
`input_required`, with `inputRequests` when there is at least one request and `requestState` when
the handler gave one, inside the envelope of §4. The client retries with an ordinary new
`tools/call` that carries `params.inputResponses` and, when it was given one, `params.requestState`.
The layer hands the handler `inputResponses` when it is an object and `requestState` when it is a
string, exactly as sent, and ignores either member otherwise. Both are the client's data: a
handler MUST treat them as untrusted (§11).

**Legacy era (OURS).** The older revisions have no interim result, so the layer asks the client
itself and runs the handler again:

1. For each request it sends the client a JSON-RPC request with that `method` and `params` and an
   `id` of the string `nimbus-sdk-<n>`, where `n` counts from 1 on the connection.
2. The `result` of the client's response is that request's answer. A JSON-RPC error from the
   client, no response within the timeout (ten minutes unless configured), and a cancellation of
   the call each count as the answer `{"action":"cancel"}`.
3. The handler runs again with the answers under the handler's keys and with the request state it
   returned. On a legacy connection the request state never reaches the client.

A handler MAY ask again. After five rounds in one call the call MUST be answered as a tool error.
A legacy input request that carries a request state but no requests MUST be answered as a tool
error: there is nothing to ask. A server MAY be built without this behaviour, and then every
input request on a legacy connection is a tool error.

## §11 Sealed request state

In the modern era the request state travels through the client, and the protocol requires a server
to treat it as attacker-controlled. This section defines a tamper-evident form for it.

**The request digest** of a call is the lowercase hex SHA-256 of the UTF-8 canonical JSON (the
[canonicalization contract](../../signing/v1/canonical-json.md)) of `{"arguments": <arguments>, "tool": <tool name>}`. Absent arguments
are `null`. The same call with its members in another order has the same digest.

**Sealing.** Given a key of at least 32 bytes, a JSON payload, a principal (a string naming who the
state is issued to), a lifetime in milliseconds and a request digest, the body is the canonical
JSON of

```json
{ "v": 1, "p": "<principal>", "d": "<request digest>", "e": <now + lifetime, ms since the epoch>, "s": <payload> }
```

and the sealed state is `base64url(body) + "." + base64url(HMAC-SHA-256(key, body))`, both parts
without padding.

**Opening** MUST check, in this order, and refuse at the first that fails:

1. `malformed`: the value is not a string of exactly two base64url parts separated by one `.`, or
   the body is not UTF-8.
2. `bad-mac`: the MAC, compared in constant time, is not the HMAC-SHA-256 of the body under the
   key. Nothing inside the body is read before this check passes.
3. `malformed`: the authentic body is not an object with `v` equal to `1` and a numeric `e`.
4. `expired`: the clock is at or past `e`.
5. `mismatch`: `p` is not the principal presenting it, or `d` is not the digest of the call it is
   presented with.

Otherwise the result is `s`. A refused state MUST be answered with error `-32602`, never with a
tool result, and the reason MUST NOT be sent to the client.

A sealed state is not encrypted: whoever holds it can read the payload, so it MUST NOT hold a
secret. It is not single use: a valid state can be presented again until it expires. A handler
that must not act twice keeps a nonce in the payload and remembers the nonces it has spent.
