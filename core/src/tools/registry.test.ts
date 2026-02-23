import { describe, expect, it, vi } from "vitest";
import { UserAbortError } from "../errors.js";
import type { ConfirmationGroup } from "./registry.js";
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

describe("ToolRegistry confirmation callback", () => {
  function makeConfirmingTool(
    name: string,
    handler?: (args: Record<string, unknown>) => Promise<string>,
  ) {
    return {
      name,
      description: `Confirming tool: ${name}`,
      parameters: { type: "object", properties: { input: { type: "string" } } },
      handler: handler ?? (async () => "executed"),
      requiresConfirmation: true as const,
    };
  }

  it("executes handler when confirmation callback approves", async () => {
    const registry = new ToolRegistry();
    const handler = vi.fn(async () => "handler ran");
    registry.register(makeConfirmingTool("write", handler));
    registry.setConfirmationCallback(async () => true);

    const result = await registry.execute("write", { path: "/tmp/test" });
    expect(result).toBe("handler ran");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("returns denial message and skips handler when callback denies", async () => {
    const registry = new ToolRegistry();
    const handler = vi.fn(async () => "should not run");
    registry.register(makeConfirmingTool("write", handler));
    registry.setConfirmationCallback(async () => false);

    const result = await registry.execute("write", {});
    expect(result).toContain("User declined");
    expect(handler).not.toHaveBeenCalled();
  });

  it("auto-approves and executes handler when no callback is set", async () => {
    const registry = new ToolRegistry();
    const handler = vi.fn(async () => "executed without callback");
    registry.register(makeConfirmingTool("write", handler));
    // No setConfirmationCallback call

    const result = await registry.execute("write", {});
    expect(result).toBe("executed without callback");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("does not call callback for tools without requiresConfirmation", async () => {
    const registry = new ToolRegistry();
    const callback = vi.fn(async () => false);
    registry.register({
      name: "read",
      description: "Read tool",
      parameters: {},
      handler: async () => "read result",
      // no requiresConfirmation
    });
    registry.setConfirmationCallback(callback);

    const result = await registry.execute("read", {});
    expect(result).toBe("read result");
    expect(callback).not.toHaveBeenCalled();
  });

  it("passes correct toolName and args to the callback", async () => {
    const registry = new ToolRegistry();
    const callback = vi.fn(async () => true);
    registry.register(makeConfirmingTool("shell"));
    registry.setConfirmationCallback(callback);

    const args = { command: "ls -la" };
    await registry.execute("shell", args);

    expect(callback).toHaveBeenCalledWith("shell", args);
  });

  it("returns error string and does not crash when callback throws", async () => {
    const registry = new ToolRegistry();
    const handler = vi.fn(async () => "should not run");
    registry.register(makeConfirmingTool("shell", handler));
    registry.setConfirmationCallback(async () => {
      throw new Error("callback exploded");
    });

    const result = await registry.execute("shell", {});
    expect(result).toContain("Error");
    expect(result).toContain("callback exploded");
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("ToolRegistry permission levels", () => {
  function makeGroupTool(name: string, group: ConfirmationGroup) {
    return {
      name,
      description: `Tool in group: ${group}`,
      parameters: {},
      handler: async () => `${name} ran`,
      confirmationGroup: group,
    };
  }

  it("write-only: write-group tool requires confirmation", async () => {
    const registry = new ToolRegistry();
    registry.register(makeGroupTool("writer", "write"));
    registry.setConfirmationCallback(async () => false);
    registry.setPermissionLevel("write-only");

    const result = await registry.execute("writer", {});
    expect(result).toContain("User declined");
  });

  it("write-only: read-group tool does NOT require confirmation", async () => {
    const registry = new ToolRegistry();
    const callback = vi.fn(async () => false);
    registry.register(makeGroupTool("reader", "read"));
    registry.setConfirmationCallback(callback);
    registry.setPermissionLevel("write-only");

    const result = await registry.execute("reader", {});
    expect(result).toBe("reader ran");
    expect(callback).not.toHaveBeenCalled();
  });

  it("read-and-write: both read and write group tools require confirmation", async () => {
    const registry = new ToolRegistry();
    const callback = vi.fn(async () => false);
    registry.register(makeGroupTool("writer", "write"));
    registry.register(makeGroupTool("reader", "read"));
    registry.setConfirmationCallback(callback);
    registry.setPermissionLevel("read-and-write");

    const writeResult = await registry.execute("writer", {});
    const readResult = await registry.execute("reader", {});
    expect(writeResult).toContain("User declined");
    expect(readResult).toContain("User declined");
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("auto-accept: no tools require confirmation", async () => {
    const registry = new ToolRegistry();
    const callback = vi.fn(async () => false);
    registry.register(makeGroupTool("writer", "write"));
    registry.register(makeGroupTool("reader", "read"));
    registry.setConfirmationCallback(callback);
    registry.setPermissionLevel("auto-accept");

    const writeResult = await registry.execute("writer", {});
    const readResult = await registry.execute("reader", {});
    expect(writeResult).toBe("writer ran");
    expect(readResult).toBe("reader ran");
    expect(callback).not.toHaveBeenCalled();
  });

  it("none-group tool never requires confirmation regardless of level", async () => {
    const registry = new ToolRegistry();
    const callback = vi.fn(async () => false);
    registry.register(makeGroupTool("memory", "none"));
    registry.setConfirmationCallback(callback);

    for (const level of ["write-only", "read-and-write", "auto-accept"] as const) {
      registry.setPermissionLevel(level);
      const result = await registry.execute("memory", {});
      expect(result).toBe("memory ran");
    }
    expect(callback).not.toHaveBeenCalled();
  });

  it("default level is write-only when setPermissionLevel not called", async () => {
    const registry = new ToolRegistry();
    const callback = vi.fn(async () => false);
    registry.register(makeGroupTool("writer", "write"));
    registry.register(makeGroupTool("reader", "read"));
    registry.setConfirmationCallback(callback);

    const writeResult = await registry.execute("writer", {});
    const readResult = await registry.execute("reader", {});
    expect(writeResult).toContain("User declined");
    expect(readResult).toBe("reader ran");
  });

  it("backward compat: requiresConfirmation without confirmationGroup defaults to write", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "legacy",
      description: "Legacy tool",
      parameters: {},
      handler: async () => "legacy ran",
      requiresConfirmation: true,
      // no confirmationGroup
    });
    registry.setConfirmationCallback(async () => false);
    registry.setPermissionLevel("write-only");

    const result = await registry.execute("legacy", {});
    expect(result).toContain("User declined");
  });
});

describe("ToolRegistry UserAbortError propagation", () => {
  it("re-throws UserAbortError from confirmation callback", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "writer",
      description: "Write tool",
      parameters: {},
      handler: async () => "should not run",
      confirmationGroup: "write",
    });
    registry.setConfirmationCallback(async () => {
      throw new UserAbortError("abort in callback");
    });

    await expect(registry.execute("writer", {})).rejects.toThrow(UserAbortError);
  });

  it("re-throws UserAbortError from tool handler", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "aborting",
      description: "Tool that aborts",
      parameters: {},
      handler: async () => {
        throw new UserAbortError("abort in handler");
      },
    });

    await expect(registry.execute("aborting", {})).rejects.toThrow(UserAbortError);
  });

  it("still catches non-abort errors from handler as error strings", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "broken",
      description: "Broken tool",
      parameters: {},
      handler: async () => {
        throw new Error("normal error");
      },
    });

    const result = await registry.execute("broken", {});
    expect(result).toContain("Error");
    expect(result).toContain("normal error");
  });

  it("still catches non-abort errors from callback as error strings", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "writer",
      description: "Write tool",
      parameters: {},
      handler: async () => "should not run",
      confirmationGroup: "write",
    });
    registry.setConfirmationCallback(async () => {
      throw new Error("normal callback error");
    });

    const result = await registry.execute("writer", {});
    expect(result).toContain("Error");
    expect(result).toContain("normal callback error");
  });
});
