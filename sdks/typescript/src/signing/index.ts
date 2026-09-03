/**
 * `@nimbus-dev/sdk/signing` — manifest canonicalization and, from a later shipment,
 * the detached JWS envelope.
 *
 * A separate entry point because signing is a separate contract with its own spec area
 * (`docs/spec/signing/v1/`) — the same claim the `.` vs `./ipc` vs `./diagnostics`
 * split already makes.
 */
export {
  CANONICALIZATION_REASONS,
  CanonicalizationError,
  type CanonicalizationReason,
  canonicalize,
  canonicalizeManifest,
} from "./canonical-json.js";
