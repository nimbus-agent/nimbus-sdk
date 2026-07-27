/**
 * Shape comparison between an emitted TypeScript interface and a JSON Schema.
 *
 * Both sides are reduced to the same small structure — a list of property names, each
 * marked optional or required, each optionally carrying its own nested member list — and
 * then diffed. That is deliberately far less than either format can express: this module
 * answers "do these two declare the same fields, with the same optionality" and nothing
 * about what values are legal. Value-level agreement is the fixture corpus's job.
 *
 * Pure: no file reads, no compiler, no ajv. Its tests run on synthetic input so that
 * editing a real schema never forces a test edit.
 *
 * Known limitation, and the reason it is acceptable today: a property whose type is a
 * *named* type declared elsewhere is not followed — only inline object literals are
 * descended into. `ExtensionManifest` has no such property (`oauth` is inline, everything
 * else is a primitive, array, or union), so nothing is currently missed. Extracting
 * `oauth` into a named interface would add an exported type — a semver-relevant change —
 * and whoever does that must extend this module in the same commit.
 *
 * That limitation is enforced rather than merely documented. Only a type that is exactly a
 * braced object literal is descended into; a type that contains braces in any other
 * arrangement — `{ a: string }[]`, `{ a: string } | null`, `Array<{ a: string }>` — throws.
 * Both alternatives are worse: descending would silently drop the array or union wrapper,
 * and skipping would report agreement on a field that was never compared.
 */

import { normalizeEol } from "./api-surface.ts";

/** One property, as declared by either side. `nested` is null unless the side describes members. */
export type PropertyShape = {
  name: string;
  optional: boolean;
  nested: PropertyShape[] | null;
};

export type ShapeDiff = {
  /** Dotted paths declared by TypeScript and absent from the schema. */
  onlyInTs: string[];
  /** Dotted paths declared by the schema and absent from TypeScript. */
  onlyInSchema: string[];
  /** Dotted paths whose optionality disagrees, with both readings named. */
  optionalityMismatch: string[];
  /** Dotted paths where one side describes members and the other does not. */
  nestingMismatch: string[];
};

export function isEmptyDiff(diff: ShapeDiff): boolean {
  return (
    diff.onlyInTs.length === 0 &&
    diff.onlyInSchema.length === 0 &&
    diff.optionalityMismatch.length === 0 &&
    diff.nestingMismatch.length === 0
  );
}

/**
 * The text between an interface declaration's outermost braces.
 *
 * Depth-tracked rather than matched to the last `}`, so a nested object literal cannot
 * truncate the body.
 */
export function interfaceBodyOf(declaration: string): string {
  const text = normalizeEol(declaration);
  const open = text.indexOf("{");
  if (open === -1) {
    throw new Error(`declaration has no braced body: ${text}`);
  }

  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }

  throw new Error(`declaration's braced body was never closed: ${text}`);
}

/** `name`, `name?`, quoted names, and names beginning with `$`. */
const MEMBER = /^(\$?[A-Za-z_][\w$]*|"[^"]+"|'[^']+')(\?)?\s*:\s*([\s\S]+)$/;

/** An index signature — `[k: string]: unknown` — is not a named property and is skipped. */
const INDEX_SIGNATURE = /^\[[^\]]*\]\s*:/;

/**
 * True only when the type is *exactly* a braced object literal — nothing trailing.
 *
 * A bare `startsWith("{")` test is not enough, and gets it wrong in the dangerous
 * direction: `{ name: string }[]` and `{ a: string } | null` both start with `{`, and
 * `interfaceBodyOf` would happily return the first brace pair's contents. The array
 * wrapper or the union arm would then vanish silently, and the guard would report
 * agreement on a shape it had misread.
 */
function isObjectLiteralType(type: string): boolean {
  if (!type.startsWith("{")) return false;
  let depth = 0;
  for (let i = 0; i < type.length; i += 1) {
    const ch = type.charAt(i);
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return type.slice(i + 1).trim().length === 0;
    }
  }
  return false;
}

/**
 * Split an interface body into members at top-level `;` and parse each one.
 *
 * Depth tracking covers `{}`, `[]`, `()` and `<>` so that a nested object, a tuple, or a
 * generic argument list never causes a split mid-member. A member the pattern does not
 * recognize throws rather than being dropped: this module exists to detect drift, and a
 * silently skipped member is drift it would report as agreement.
 */
export function parseMembers(body: string): PropertyShape[] {
  const text = normalizeEol(body);
  const members: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (ch === "{" || ch === "[" || ch === "(" || ch === "<") depth += 1;
    else if (ch === "}" || ch === "]" || ch === ")" || ch === ">") depth -= 1;
    else if (ch === ";" && depth === 0) {
      members.push(text.slice(start, i));
      start = i + 1;
    }
  }
  members.push(text.slice(start));

  const shapes: PropertyShape[] = [];
  for (const raw of members) {
    const member = raw.trim();
    if (member.length === 0) continue;
    if (INDEX_SIGNATURE.test(member)) continue;

    const match = MEMBER.exec(member);
    if (match === null) {
      throw new Error(
        `could not parse interface member: ${member}\n` +
          "This module must never silently drop a member — a dropped member is drift " +
          "reported as agreement. Extend the pattern deliberately if this form is real.",
      );
    }

    const name = (match[1] ?? "").replace(/^["']|["']$/g, "");
    const optional = match[2] !== undefined;
    const type = (match[3] ?? "").trim();

    const isLiteral = isObjectLiteralType(type);
    if (!isLiteral && type.includes("{")) {
      throw new Error(
        `member "${name}" has a type containing braces that is not a plain object literal: ${type}\n` +
          "Descending into it would misread the shape (an array or union wrapper would " +
          "vanish), and skipping it would report agreement on a field never compared. " +
          "Extend this module deliberately to handle the construct.",
      );
    }

    shapes.push({
      name,
      optional,
      nested: isLiteral ? parseMembers(interfaceBodyOf(type)) : null,
    });
  }

  return shapes;
}

/** The property tree of an emitted interface declaration. */
export function tsShapeOf(declaration: string): PropertyShape[] {
  return parseMembers(interfaceBodyOf(declaration));
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${what} is not an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * The property tree of a JSON Schema object.
 *
 * Recurses only where the schema itself describes members — `type: "object"` *with* a
 * `properties` map. An open object such as `{"type":"object"}` (the shape
 * `Record<string, unknown>` maps to) yields `nested: null`, matching what the TypeScript
 * side produces for the same declaration.
 */
export function schemaShapeOf(schema: unknown): PropertyShape[] {
  const root = asRecord(schema, "schema");

  const rawRequired = root["required"] ?? [];
  if (!Array.isArray(rawRequired) || rawRequired.some((r) => typeof r !== "string")) {
    throw new Error('schema\'s "required" must be an array of strings');
  }
  const required = new Set(rawRequired as string[]);

  const properties = root["properties"];
  if (properties === undefined) {
    throw new Error('schema has no "properties" object');
  }
  const props = asRecord(properties, 'schema\'s "properties"');

  return Object.keys(props)
    .sort()
    .map((name) => {
      const child = asRecord(props[name], `property "${name}"`);
      const describesMembers = child["type"] === "object" && child["properties"] !== undefined;
      return {
        name,
        optional: !required.has(name),
        nested: describesMembers ? schemaShapeOf(child) : null,
      };
    });
}

function byName(shapes: readonly PropertyShape[]): Map<string, PropertyShape> {
  return new Map(shapes.map((shape) => [shape.name, shape]));
}

/**
 * Diff two property trees, reporting dotted paths.
 *
 * Every category is reported in both directions. A one-directional diff would let a
 * property added to the schema alone pass, which is the same silent divergence a property
 * added to TypeScript alone represents.
 */
export function diffShapes(
  ts: readonly PropertyShape[],
  schema: readonly PropertyShape[],
  path = "",
): ShapeDiff {
  const diff: ShapeDiff = {
    onlyInTs: [],
    onlyInSchema: [],
    optionalityMismatch: [],
    nestingMismatch: [],
  };

  const tsByName = byName(ts);
  const schemaByName = byName(schema);
  const at = (name: string): string => (path === "" ? name : `${path}.${name}`);

  for (const shape of ts) {
    if (!schemaByName.has(shape.name)) diff.onlyInTs.push(at(shape.name));
  }
  for (const shape of schema) {
    if (!tsByName.has(shape.name)) diff.onlyInSchema.push(at(shape.name));
  }

  for (const tsShape of ts) {
    const schemaShape = schemaByName.get(tsShape.name);
    if (schemaShape === undefined) continue;

    if (tsShape.optional !== schemaShape.optional) {
      diff.optionalityMismatch.push(
        `${at(tsShape.name)} (TypeScript: ${tsShape.optional ? "optional" : "required"}, ` +
          `schema: ${schemaShape.optional ? "optional" : "required"})`,
      );
    }

    const tsNested = tsShape.nested;
    const schemaNested = schemaShape.nested;
    if (tsNested !== null && schemaNested !== null) {
      const child = diffShapes(tsNested, schemaNested, at(tsShape.name));
      diff.onlyInTs.push(...child.onlyInTs);
      diff.onlyInSchema.push(...child.onlyInSchema);
      diff.optionalityMismatch.push(...child.optionalityMismatch);
      diff.nestingMismatch.push(...child.nestingMismatch);
    } else if (tsNested !== null) {
      diff.nestingMismatch.push(
        `${at(tsShape.name)} (TypeScript describes members, schema does not)`,
      );
    } else if (schemaNested !== null) {
      diff.nestingMismatch.push(
        `${at(tsShape.name)} (schema describes members, TypeScript does not)`,
      );
    }
  }

  return diff;
}
