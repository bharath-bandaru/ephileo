import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  formatPermissionStatus,
  handlePermissionsCommand,
  promptPermissionLevel,
} from "./permissions.js";

// --- Helpers ---------------------------------------------------------------

type MockInput = PassThrough & {
  isTTY: boolean;
  isRaw: boolean;
  setRawMode: (mode: boolean) => void;
};

function createMockInput(isTTY = true, isRaw = false): MockInput {
  const stream = new PassThrough() as MockInput;
  stream.isTTY = isTTY;
  stream.isRaw = isRaw;
  stream.setRawMode = () => {};
  return stream;
}

function collectOutput(output: PassThrough): () => string {
  const chunks: Buffer[] = [];
  output.on("data", (chunk: Buffer) => chunks.push(chunk));
  return () => chunks.map((c) => c.toString("utf-8")).join("");
}

// --- formatPermissionStatus ------------------------------------------------

describe("formatPermissionStatus", () => {
  it("formats write-only level", () => {
    const result = formatPermissionStatus("write-only");
    expect(result).toContain("write only");
    expect(result).toContain("recommended");
  });

  it("formats read-and-write level", () => {
    const result = formatPermissionStatus("read-and-write");
    expect(result).toContain("read and write");
  });

  it("formats auto-accept level", () => {
    const result = formatPermissionStatus("auto-accept");
    expect(result).toContain("auto accept");
  });
});

// --- promptPermissionLevel -------------------------------------------------

describe("promptPermissionLevel", () => {
  it("selects write-only on key '1'", async () => {
    const input = createMockInput();
    const output = new PassThrough();
    output.resume();
    const promise = promptPermissionLevel({ input, output });
    input.write(Buffer.from([0x31])); // '1'
    const result = await promise;
    expect(result).toBe("write-only");
  });

  it("selects read-and-write on key '2'", async () => {
    const input = createMockInput();
    const output = new PassThrough();
    output.resume();
    const promise = promptPermissionLevel({ input, output });
    input.write(Buffer.from([0x32])); // '2'
    const result = await promise;
    expect(result).toBe("read-and-write");
  });

  it("selects auto-accept on key '3'", async () => {
    const input = createMockInput();
    const output = new PassThrough();
    output.resume();
    const promise = promptPermissionLevel({ input, output });
    input.write(Buffer.from([0x33])); // '3'
    const result = await promise;
    expect(result).toBe("auto-accept");
  });

  it("Enter defaults to write-only", async () => {
    const input = createMockInput();
    const output = new PassThrough();
    output.resume();
    const promise = promptPermissionLevel({ input, output });
    input.write(Buffer.from([0x0d])); // CR (Enter)
    const result = await promise;
    expect(result).toBe("write-only");
  });

  it("LF also defaults to write-only", async () => {
    const input = createMockInput();
    const output = new PassThrough();
    output.resume();
    const promise = promptPermissionLevel({ input, output });
    input.write(Buffer.from([0x0a])); // LF
    const result = await promise;
    expect(result).toBe("write-only");
  });

  it("ignores invalid keys then accepts valid key", async () => {
    const input = createMockInput();
    const output = new PassThrough();
    output.resume();
    const promise = promptPermissionLevel({ input, output });
    input.write(Buffer.from([0x41])); // 'A' — ignored
    input.write(Buffer.from([0x20])); // space — ignored
    input.write(Buffer.from([0x32])); // '2' — accepted
    const result = await promise;
    expect(result).toBe("read-and-write");
  });

  it("returns write-only for non-TTY input with warning", async () => {
    const input = createMockInput(false); // isTTY = false
    const output = new PassThrough();
    const getOutput = collectOutput(output);
    const result = await promptPermissionLevel({ input, output });
    expect(result).toBe("write-only");
    const written = getOutput();
    expect(written).toContain("non-TTY");
    expect(written).toContain("write-only");
  });

  it("displays all three options in output", async () => {
    const input = createMockInput();
    const output = new PassThrough();
    const getOutput = collectOutput(output);
    const promise = promptPermissionLevel({ input, output });
    input.write(Buffer.from([0x31])); // '1' to resolve
    await promise;
    const written = getOutput();
    expect(written).toContain("write only");
    expect(written).toContain("read and write");
    expect(written).toContain("auto accept");
  });
});

// --- handlePermissionsCommand ----------------------------------------------

describe("handlePermissionsCommand", () => {
  it("shows current level and returns new selection", async () => {
    const input = createMockInput();
    const output = new PassThrough();
    const getOutput = collectOutput(output);
    const promise = handlePermissionsCommand("write-only", { input, output });
    input.write(Buffer.from([0x33])); // '3'
    const result = await promise;
    expect(result).toBe("auto-accept");
    const written = getOutput();
    expect(written).toContain("Current:");
    expect(written).toContain("write only");
  });

  it("displays current level in output when starting from auto-accept", async () => {
    const input = createMockInput();
    const output = new PassThrough();
    const getOutput = collectOutput(output);
    const promise = handlePermissionsCommand("auto-accept", { input, output });
    input.write(Buffer.from([0x31])); // '1'
    await promise;
    const written = getOutput();
    expect(written).toContain("auto accept");
  });
});
