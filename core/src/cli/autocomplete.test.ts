import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  type CompletionItem,
  clearMenu,
  createAutocomplete,
  getSelectedItem,
  moveSelection,
  renderMenu,
  updateFilter,
} from "./autocomplete.js";

// --- Helpers ----------------------------------------------------------------

const ITEMS: CompletionItem[] = [
  { name: "permissions", description: "View or change permission level" },
  { name: "help", description: "Show available commands" },
  { name: "quit", description: "Exit Ephileo" },
  { name: "clear", description: "Clear chat and start fresh" },
];

function collectOutput(stream: PassThrough): () => string {
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  return () => chunks.map((c) => c.toString("utf-8")).join("");
}

// --- createAutocomplete -----------------------------------------------------

describe("createAutocomplete", () => {
  it("initializes with all items and selectedIndex 0", () => {
    const state = createAutocomplete(ITEMS);
    expect(state.allItems).toEqual(ITEMS);
    expect(state.filtered).toEqual(ITEMS);
    expect(state.selectedIndex).toBe(0);
    expect(state.renderedLineCount).toBe(0);
  });

  it("creates independent filtered copy", () => {
    const state = createAutocomplete(ITEMS);
    state.filtered.pop();
    expect(state.allItems).toHaveLength(ITEMS.length);
  });
});

// --- updateFilter -----------------------------------------------------------

describe("updateFilter", () => {
  it("returns all items for empty filter", () => {
    const state = createAutocomplete(ITEMS);
    updateFilter(state, "");
    expect(state.filtered).toHaveLength(ITEMS.length);
  });

  it("filters by prefix case-insensitively", () => {
    const state = createAutocomplete(ITEMS);
    updateFilter(state, "he");
    expect(state.filtered).toHaveLength(1);
    expect(state.filtered[0].name).toBe("help");
  });

  it("filters with uppercase input", () => {
    const state = createAutocomplete(ITEMS);
    updateFilter(state, "HE");
    expect(state.filtered).toHaveLength(1);
    expect(state.filtered[0].name).toBe("help");
  });

  it("returns empty for no matches", () => {
    const state = createAutocomplete(ITEMS);
    updateFilter(state, "xyz");
    expect(state.filtered).toHaveLength(0);
  });

  it("clamps selectedIndex when filtered list shrinks", () => {
    const state = createAutocomplete(ITEMS);
    state.selectedIndex = 3; // last item
    updateFilter(state, "he"); // 1 match
    expect(state.selectedIndex).toBe(0);
  });

  it("keeps selectedIndex within range when still valid", () => {
    const state = createAutocomplete(ITEMS);
    state.selectedIndex = 1;
    updateFilter(state, ""); // all items
    expect(state.selectedIndex).toBe(1);
  });
});

// --- moveSelection ----------------------------------------------------------

describe("moveSelection", () => {
  it("moves down within bounds", () => {
    const state = createAutocomplete(ITEMS);
    moveSelection(state, "down");
    expect(state.selectedIndex).toBe(1);
  });

  it("wraps down to first item", () => {
    const state = createAutocomplete(ITEMS);
    state.selectedIndex = ITEMS.length - 1;
    moveSelection(state, "down");
    expect(state.selectedIndex).toBe(0);
  });

  it("moves up within bounds", () => {
    const state = createAutocomplete(ITEMS);
    state.selectedIndex = 2;
    moveSelection(state, "up");
    expect(state.selectedIndex).toBe(1);
  });

  it("wraps up to last item", () => {
    const state = createAutocomplete(ITEMS);
    moveSelection(state, "up");
    expect(state.selectedIndex).toBe(ITEMS.length - 1);
  });

  it("does nothing on empty filtered list", () => {
    const state = createAutocomplete([]);
    moveSelection(state, "down");
    expect(state.selectedIndex).toBe(0);
  });
});

// --- getSelectedItem --------------------------------------------------------

describe("getSelectedItem", () => {
  it("returns the highlighted item", () => {
    const state = createAutocomplete(ITEMS);
    state.selectedIndex = 2;
    const item = getSelectedItem(state);
    expect(item).toEqual(ITEMS[2]);
  });

  it("returns null for empty list", () => {
    const state = createAutocomplete([]);
    expect(getSelectedItem(state)).toBeNull();
  });
});

// --- renderMenu -------------------------------------------------------------

describe("renderMenu", () => {
  it("writes highlighted and dimmed lines", () => {
    const output = new PassThrough();
    const getOutput = collectOutput(output);
    const state = createAutocomplete(ITEMS);

    renderMenu(output, state);

    const written = getOutput();
    // First item should be highlighted (contains ">")
    expect(written).toContain("> /permissions");
    // Other items should be dimmed (no ">")
    expect(written).toContain("/help");
    expect(written).toContain("/quit");
    expect(written).toContain("/clear");
  });

  it("updates renderedLineCount", () => {
    const output = new PassThrough();
    output.resume();
    const state = createAutocomplete(ITEMS);
    renderMenu(output, state);
    expect(state.renderedLineCount).toBe(ITEMS.length);
  });

  it("does nothing for empty filtered list", () => {
    const output = new PassThrough();
    const getOutput = collectOutput(output);
    const state = createAutocomplete([]);
    renderMenu(output, state);
    expect(getOutput()).toBe("");
    expect(state.renderedLineCount).toBe(0);
  });

  it("clears previous render before writing new one", () => {
    const output = new PassThrough();
    output.resume();
    const state = createAutocomplete(ITEMS);
    state.renderedLineCount = 2; // simulate previous render
    renderMenu(output, state);
    expect(state.renderedLineCount).toBe(ITEMS.length);
  });
});

// --- clearMenu --------------------------------------------------------------

describe("clearMenu", () => {
  it("clears the correct number of lines", () => {
    const output = new PassThrough();
    const getOutput = collectOutput(output);
    const state = createAutocomplete(ITEMS);
    const lineCount = 3;
    state.renderedLineCount = lineCount;

    clearMenu(output, state);

    const written = getOutput();
    // Should have 3 newlines (one per cleared line)
    const newlineCount = (written.match(/\n/g) ?? []).length;
    expect(newlineCount).toBe(lineCount);
    expect(state.renderedLineCount).toBe(0);
  });

  it("does nothing when renderedLineCount is 0", () => {
    const output = new PassThrough();
    const getOutput = collectOutput(output);
    const state = createAutocomplete(ITEMS);
    clearMenu(output, state);
    expect(getOutput()).toBe("");
  });
});
