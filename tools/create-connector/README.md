# @nimbus-dev/create-connector

Scaffold a [Nimbus](https://github.com/nimbus-agent/Nimbus) MCP connector that performs the
contract-version handshake and then serves MCP tools over the same two streams.

```bash
npm create @nimbus-dev/connector@latest my-connector                     # TypeScript
npx @nimbus-dev/create-connector@latest my-connector --lang python       # Python
```

The Python line uses `npx` deliberately. `npm create` runs `npm exec` underneath, which parses
npm's own flags first, so `npm create @nimbus-dev/connector@latest my-conn --lang python` silently
hands you a **TypeScript** project. The `npm create` equivalent is
`npm create @nimbus-dev/connector@latest my-conn -- --lang python`.

Node ≥22 is needed to run the scaffolder. The generated Python project does not depend on Node.

Full walkthroughs: [TypeScript](https://github.com/nimbus-agent/nimbus-sdk/blob/main/docs/quickstart-typescript.md),
[Python](https://github.com/nimbus-agent/nimbus-sdk/blob/main/docs/quickstart-python.md).

## Adding a file to a template

**Do not add a dotfile to a template assuming it ships.** npm removes several names from every
published tarball regardless of `files` — `.gitignore` is why `templates/*/_gitignore` is spelled
that way and renamed by `TEMPLATE_FILE_RENAMES` in `src/generate.ts`, and it is not the only such
name. Add the file, then run `bun test src/pack-and-generate.test.ts`: it packs this package and
generates from the tarball, and it fails if what the registry would ship differs from what the
checkout produces. Let the guard tell you.

MIT.
