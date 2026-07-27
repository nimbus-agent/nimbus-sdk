<!-- covers: flux-cd/index -->

# `flux-cd`

The registry of Flux CD custom-resource kinds Nimbus indexes, and the small string helper
that goes with building API URLs against them.

## When you reach for it

When a connector talks to a Flux-managed cluster and needs the group, version, and plural
for a kind in order to construct a Kubernetes API path.

## Constraints that are load-bearing

- **One registry, two consumers.** The gateway connector and the MCP connector both read
  `FLUX_KINDS`, so a kind added here is added for both at once. Copying the table into a
  connector reintroduces the drift this module removes.
- **Pure.** No I/O, no env reads, no network — the API fetch stays in each caller. See the
  [inclusion policy](../INCLUSION-POLICY.md#2-pure--hidden-ambient-state-is-forbidden-substitutable-effects-are-seamed).
- **`kind` values are the registry's own snake_case keys, not Kubernetes `Kind` names.**
  Look up `"helm_release"`, not `"HelmRelease"`. The Kubernetes-facing strings you need for
  a URL are `group`, `version`, and `plural`.
- **`readonly` is compile-time only.** There is no `Object.freeze`, so a consumer in plain
  JavaScript — or one that casts the type away — can mutate the shared array for everyone
  in the process. Treat a missing kind as "not indexed" and add it here, rather than
  pushing onto `FLUX_KINDS` at a call site.

## Example

```ts
import { FLUX_KINDS, type FluxKindEntry, trimTrailingSlash } from "@nimbus-dev/sdk";

/**
 * `kind` is a registry key — "kustomization", "helm_release" — not a Kubernetes `Kind`.
 * e.g. apiPath("https://cluster/", "kustomization") →
 *   "https://cluster/apis/kustomize.toolkit.fluxcd.io/v1/kustomizations"
 */
export function apiPath(baseUrl: string, kind: string): string | null {
  const entry: FluxKindEntry | undefined = FLUX_KINDS.find((k) => k.kind === kind);
  if (entry === undefined) return null;
  return `${trimTrailingSlash(baseUrl)}/apis/${entry.group}/${entry.version}/${entry.plural}`;
}

export const indexedKinds: string[] = FLUX_KINDS.map((entry) => entry.kind);
```

## Every export

Signatures live in [`api-surface.md`](../api-surface.md) — the generated snapshot of the
published contract. They are not repeated here, so there is only ever one copy to keep
correct.
