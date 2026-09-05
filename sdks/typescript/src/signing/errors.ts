import type { CanonicalizationReason } from "./canonical-json.js";

/**
 * Rejection reasons for the detached JWS envelope.
 *
 * @moduleStability experimental
 *
 * The binding of `docs/spec/signing/v1/manifest-signature.md` §10. The set is closed:
 * a binding may never invent an eleventh. It is deliberately independent of
 * `CanonicalizationReason` — §9's `canonicalization-failed` wraps that set rather than
 * absorbing it, so a consumer switching on one never has to know about the other.
 */
export type SignatureReason =
  | "envelope-malformed"
  | "base64url-invalid"
  | "protected-malformed"
  | "crit-unsupported"
  | "protected-unknown-member"
  | "kid-unknown"
  | "key-unsupported"
  | "alg-unsupported"
  | "canonicalization-failed"
  | "signature-invalid";

export const SIGNATURE_REASONS: readonly SignatureReason[] = [
  "envelope-malformed",
  "base64url-invalid",
  "protected-malformed",
  "crit-unsupported",
  "protected-unknown-member",
  "kid-unknown",
  "key-unsupported",
  "alg-unsupported",
  "canonicalization-failed",
  "signature-invalid",
];

export class SignatureError extends Error {
  readonly reason: SignatureReason;
  /** Set only when `reason` is `canonicalization-failed`. */
  readonly canonicalizationReason?: CanonicalizationReason;

  constructor(
    reason: SignatureReason,
    options?: { canonicalizationReason?: CanonicalizationReason; cause?: unknown },
  ) {
    super(`manifest signature rejected: ${reason}`, { cause: options?.cause });
    this.name = "SignatureError";
    this.reason = reason;
    if (options?.canonicalizationReason !== undefined) {
      this.canonicalizationReason = options.canonicalizationReason;
    }
  }
}
