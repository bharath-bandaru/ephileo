/**
 * Shared error types used across layers.
 *
 * Custom error classes allow callers to distinguish user-initiated
 * cancellation from real errors using instanceof checks.
 */

/**
 * Thrown when the user cancels an in-flight operation (e.g. presses Escape).
 * Carries any partial LLM response accumulated before the abort.
 */
export class UserAbortError extends Error {
  readonly partialContent: string;

  constructor(message = "Operation cancelled by user", partialContent = "") {
    super(message);
    this.name = "UserAbortError";
    this.partialContent = partialContent;
  }
}
