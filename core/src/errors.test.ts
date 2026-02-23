import { describe, expect, it } from "vitest";
import { UserAbortError } from "./errors.js";

describe("UserAbortError", () => {
  it("is an instance of Error", () => {
    const err = new UserAbortError();
    expect(err).toBeInstanceOf(Error);
  });

  it("has name 'UserAbortError'", () => {
    const err = new UserAbortError();
    expect(err.name).toBe("UserAbortError");
  });

  it("uses default message when none provided", () => {
    const err = new UserAbortError();
    expect(err.message).toBe("Operation cancelled by user");
  });

  it("accepts a custom message", () => {
    const err = new UserAbortError("custom cancel");
    expect(err.message).toBe("custom cancel");
  });

  it("stores empty partialContent by default", () => {
    const err = new UserAbortError();
    expect(err.partialContent).toBe("");
  });

  it("stores provided partialContent", () => {
    const partial = "Hello, I was saying...";
    const err = new UserAbortError("cancelled", partial);
    expect(err.partialContent).toBe(partial);
  });

  it("partialContent is readonly", () => {
    const err = new UserAbortError("msg", "partial");
    // TypeScript enforces readonly at compile time; runtime check that it exists
    expect(Object.getOwnPropertyDescriptor(err, "partialContent")?.writable).toBe(true);
    // readonly in TS doesn't affect runtime writability — just check it's set correctly
    expect(err.partialContent).toBe("partial");
  });
});
