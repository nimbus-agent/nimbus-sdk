<!-- covers: hitl-request -->

# `hitl-request`

The shape of a human-in-the-loop request — the payload a connector hands the gate when an
action needs a person to approve it — and the guard that recognizes one.

## When you reach for it

When your manifest declares `hitlRequired` and you need to describe a pending write or
delete to the approver, or when you are on the receiving side and must validate an
untrusted payload before rendering it.

## Constraints that are load-bearing

- **`summary` is what a human reads and approves.** It must describe the effect, not the
  mechanism. An approval granted against a vague summary is not consent.
- **`diff` is optional but is the difference between approval and guesswork.** Include it
  whenever the action is expressible as a before/after.
- **`isHitlRequest` is total.** It takes `unknown` and never throws. `actionId` and
  `summary` must both be strings of non-zero length — but the check is `length > 0` on the
  raw string, **not** on a trimmed one, so `summary: "   "` passes the guard and reaches the
  approver as a blank prompt. Trim before you build the request; the guard will not do it for
  you. `diff` is checked only for being a string when present, so an empty `diff` passes too;
  if a blank diff means something to your UI, test for it yourself.

## Example

```ts
import { type HitlRequest, isHitlRequest } from "@nimbus-dev/sdk";

export function describeRequest(payload: unknown): string {
  if (!isHitlRequest(payload)) return "not a HITL request";
  const request: HitlRequest = payload;
  const detail = request.diff === undefined ? "" : `\n${request.diff}`;
  return `${request.actionId}: ${request.summary}${detail}`;
}
```

## Every export

Signatures live in [`api-surface.md`](../api-surface.md) — the generated snapshot of the
published contract. They are not repeated here, so there is only ever one copy to keep
correct.
