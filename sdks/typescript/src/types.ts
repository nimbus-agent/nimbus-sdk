/**
 * Shared types for Nimbus extensions
 */

import type { KnownItemType } from "./item-types.js";

/**
 * An indexed item's type. Open by design — see `item-types.ts`. The
 * `(string & {})` arm keeps editor autocomplete for KnownItemType while
 * accepting types a newer gateway emits.
 */
export type ItemType = KnownItemType | (string & {});

export interface NimbusItem {
  id: string;
  service: string;
  itemType: ItemType;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  createdAt?: number;
  modifiedAt?: number;
  url?: string;
  parentId?: string;
  rawMeta?: Record<string, unknown>;
}

export interface ExtensionManifest {
  $schema?: string;
  id: string;
  displayName: string;
  version: string;
  description: string;
  author: string;
  homepage?: string;
  icon?: string;
  entrypoint: string;
  runtime: "bun" | "node" | "python";
  permissions: Array<"read" | "write" | "delete">;
  hitlRequired: Array<"write" | "delete">;
  oauth?: {
    provider: string;
    scopes: string[];
    authUrl: string;
    tokenUrl: string;
    pkce: boolean;
  };
  syncInterval?: number;
  tags?: string[];
  /**
   * The contract majors this connector speaks — see `docs/spec/negotiation/v1/`.
   *
   * Optional, and absence means `["1"]`. Not the same axis as `minNimbusVersion`, which is a
   * floor on the gateway product. Becomes required at the next contract major.
   */
  contractVersions?: string[];
  minNimbusVersion: string;
}
