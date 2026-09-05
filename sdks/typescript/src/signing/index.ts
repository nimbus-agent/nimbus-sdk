/**
 * `@nimbus-dev/sdk/signing` — manifest canonicalization and the detached JWS envelope
 * built on top of it: strict base64url, the RFC 7638 JWK thumbprint, the protected
 * header and signing input, and sign / verify / keygen.
 *
 * A separate entry point because signing is a separate contract with its own spec area
 * (`docs/spec/signing/v1/`) — the same claim the `.` vs `./ipc` vs `./diagnostics`
 * split already makes.
 */
export { base64urlDecode, base64urlEncode } from "./base64url.js";
export {
  CANONICALIZATION_REASONS,
  CanonicalizationError,
  type CanonicalizationReason,
  canonicalize,
  canonicalizeManifest,
} from "./canonical-json.js";
export { SIGNATURE_REASONS, SignatureError, type SignatureReason } from "./errors.js";
export { type Jwk, jwkThumbprint, type PrivateJwk } from "./jwk.js";
export {
  encodeProtectedHeader,
  type ProtectedHeader,
  parseProtectedHeader,
  signingInput,
} from "./jws.js";
export {
  generateSigningKey,
  type ManifestSignatureEnvelope,
  signManifest,
  verifyManifestSignature,
} from "./manifest-signature.js";
