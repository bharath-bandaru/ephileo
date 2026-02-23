import { describe, expect, it } from "vitest";
import { CommandRegistry } from "./commands.js";

describe("CommandRegistry", () => {
  it("dispatches a registered command", async () => {
    const registry = new CommandRegistry();
    registry.register("test", "A test command", async () => ({
      handled: true,
      message: "test ran",
    }));

    const result = await registry.dispatch("/test");
    expect(result).not.toBeNull();
    expect(result?.handled).toBe(true);
    expect(result?.message).toBe("test ran");
  });

  it("passes args after the command name", async () => {
    const registry = new CommandRegistry();
    let receivedArgs = "";
    registry.register("echo", "Echo args", async (args) => {
      receivedArgs = args;
      return { handled: true };
    });

    await registry.dispatch("/echo hello world");
    expect(receivedArgs).toBe("hello world");
  });

  it("returns null for non-slash input", async () => {
    const registry = new CommandRegistry();
    registry.register("test", "Test", async () => ({ handled: true }));

    const result = await registry.dispatch("not a command");
    expect(result).toBeNull();
  });

  it("reports unknown commands with available list", async () => {
    const registry = new CommandRegistry();
    registry.register("permissions", "Manage permissions", async () => ({ handled: true }));

    const result = await registry.dispatch("/unknown");
    expect(result).not.toBeNull();
    expect(result?.handled).toBe(true);
    expect(result?.message).toContain("Unknown command");
    expect(result?.message).toContain("/unknown");
    expect(result?.message).toContain("/permissions");
  });

  it("handles command with no args", async () => {
    const registry = new CommandRegistry();
    let receivedArgs = "not-empty";
    registry.register("help", "Show help", async (args) => {
      receivedArgs = args;
      return { handled: true };
    });

    await registry.dispatch("/help");
    expect(receivedArgs).toBe("");
  });

  it("getCompletions returns all registered commands", () => {
    const registry = new CommandRegistry();
    registry.register("permissions", "Manage permissions", async () => ({ handled: true }));
    registry.register("help", "Show help", async () => ({ handled: true }));

    const completions = registry.getCompletions();
    expect(completions).toHaveLength(2);
    expect(completions[0]).toEqual({ name: "permissions", description: "Manage permissions" });
    expect(completions[1]).toEqual({ name: "help", description: "Show help" });
  });

  it("getCompletions returns empty array when no commands", () => {
    const registry = new CommandRegistry();
    expect(registry.getCompletions()).toEqual([]);
  });

  it("formatHelp lists all commands", () => {
    const registry = new CommandRegistry();
    registry.register("permissions", "Manage permissions", async () => ({ handled: true }));
    registry.register("help", "Show help", async () => ({ handled: true }));

    const help = registry.formatHelp();
    expect(help).toContain("/permissions");
    expect(help).toContain("/help");
    expect(help).toContain("Manage permissions");
  });
});
