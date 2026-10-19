<!-- covers: sync/index -->

# `sync`

The sync contract: how an extension hands indexable items to the gateway. Its own entry
point: `import { validateSyncResponse } from "@nimbus-dev/sdk/sync"`.

The normative specification is [`spec/sync/v1/sync.md`](../spec/sync/v1/sync.md), with a
corpus of valid and invalid responses in [`spec/sync/v1/corpus/`](../spec/sync/v1/corpus/).
The gateway implements the same rules independently and does not import this module; the
helper exists so an extension's own tests can check the pages it returns.

```ts
import { SYNC_TOOL_NAME, validateSyncResponse } from "@nimbus-dev/sdk/sync";

const page = { status: "ok", items: [], cursor: null, hasMore: false };
const result = validateSyncResponse(page);
if (!result.ok) throw new Error(`${SYNC_TOOL_NAME} returned a bad page: ${result.reason}`);
```

An extension exposes one tool named `__nimbus_sync` (every `__nimbus_`-prefixed name is
reserved to the gateway) and declares a `sync` block in its manifest. `validateSyncResponse`
is structural only: size limits, the declared item types and `externalId` collisions are
checked by the gateway.

This module is `experimental`, and TypeScript-only: Python and Go publish no sync surface.
