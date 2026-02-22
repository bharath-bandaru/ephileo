import { describe, expect, it } from "vitest";
import { ToolRegistry } from "./registry.js";

function makeTestTool(name: string, handler?: (args: Record<string, unknown>) => Promise<string>) {
  return {
    name,
    description: `Test tool: ${name}`,
    parameters: { type: "object", properties: { input: { type: "string" } } },
    handler: handler ?? (async () => "ok"),
  };
}

describe("ToolRegistry", () => {
  it("registers and lists tools by name", () => {
    const registry = new ToolRegistry();
    registry.register(makeTestTool("alpha"));
    registry.register(makeTestTool("beta"));

    expect(registry.listNames()).toEqual(["alpha", "beta"]);
  });

  it("returns schemas in OpenAI function-calling format", () => {
    const registry = new ToolRegistry();
    registry.register(makeTestTool("greet"));

    const schemas = registry.getSchemas();
    expect(schemas).toHaveLength(1);
    expect(schemas[0]).toEqual({
      type: "function",
      function: {
        name: "greet",
        description: "Test tool: greet",
        parameters: { type: "object", properties: { input: { type: "string" } } },
      },
    });
  });

  it("executes a registered tool and returns its result", async () => {
    const registry = new ToolRegistry();
    registry.register(makeTestTool("echo", async (args) => `echoed: ${String(args.input)}`));

    const result = await registry.execute("echo", { input: "hello" });
    expect(result).toBe("echoed: hello");
  });

  it("returns an error string for unknown tools", async () => {
    const registry = new ToolRegistry();
    const result = await registry.execute("nonexistent", {});
    expect(result).toContain("Error");
    expect(result).toContain("nonexistent");
  });

  it("catches handler errors and returns an error string", async () => {
    const registry = new ToolRegistry();
    registry.register(
      makeTestTool("broken", async () => {
        throw new Error("handler exploded");
      }),
    );

    const result = await registry.execute("broken", {});
    expect(result).toContain("Error");
    expect(result).toContain("handler exploded");
  });
});
