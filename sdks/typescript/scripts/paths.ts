/**
 * Where things are.
 *
 * `packageRoot` is the npm package (`package.json`, `src/`, `dist/`). `repoRoot` is the
 * repository (`docs/`, and the language-neutral `docs/spec/` the guards validate against).
 *
 * The package lives at `sdks/typescript/` (three levels below the repository root), so
 * `packageRoot` and `repoRoot` resolve to different directories — which is the entire
 * reason this module exists.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** The npm package root — parent of `src/`, `dist/`, `scripts/`. */
export const packageRoot = join(here, "..");

/** The repository root — parent of `docs/`. */
export const repoRoot = join(here, "..", "..", "..");

export const joinPackage = (...parts: string[]): string => join(packageRoot, ...parts);
export const joinRepo = (...parts: string[]): string => join(repoRoot, ...parts);

export const readFromPackage = (path: string): string => readFileSync(joinPackage(path), "utf8");
export const readFromRepo = (path: string): string => readFileSync(joinRepo(path), "utf8");
