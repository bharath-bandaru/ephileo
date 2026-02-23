/**
 * Autocomplete menu state management and rendering for slash commands.
 *
 * Pure state transitions with ANSI terminal rendering. The menu appears
 * below the current input line and supports arrow-key navigation.
 */

import type { Writable } from "node:stream";
import { DIM, RESET, YELLOW } from "./ansi.js";

// --- ANSI rendering constants -----------------------------------------------

const SAVE_CURSOR = "\x1b7";
const RESTORE_CURSOR = "\x1b8";
const CLEAR_LINE = "\x1b[2K";

// --- Public types -----------------------------------------------------------

export interface CompletionItem {
  name: string;
  description: string;
}

export interface AutocompleteState {
  allItems: CompletionItem[];
  filtered: CompletionItem[];
  selectedIndex: number;
  /** Number of terminal lines last rendered (used for clearing). */
  renderedLineCount: number;
}

// --- State management -------------------------------------------------------

/** Create a fresh autocomplete state from a list of completion items. */
export function createAutocomplete(items: CompletionItem[]): AutocompleteState {
  return {
    allItems: items,
    filtered: [...items],
    selectedIndex: 0,
    renderedLineCount: 0,
  };
}

/** Update the filtered list based on a prefix filter string (case-insensitive). */
export function updateFilter(state: AutocompleteState, filter: string): void {
  const lower = filter.toLowerCase();
  state.filtered = lower
    ? state.allItems.filter((item) => item.name.toLowerCase().startsWith(lower))
    : [...state.allItems];
  // Clamp selectedIndex to valid range
  if (state.selectedIndex >= state.filtered.length) {
    state.selectedIndex = Math.max(0, state.filtered.length - 1);
  }
}

/** Move the selection highlight up or down, wrapping at boundaries. */
export function moveSelection(state: AutocompleteState, direction: "up" | "down"): void {
  if (state.filtered.length === 0) return;
  if (direction === "up") {
    state.selectedIndex =
      state.selectedIndex > 0 ? state.selectedIndex - 1 : state.filtered.length - 1;
  } else {
    state.selectedIndex =
      state.selectedIndex < state.filtered.length - 1 ? state.selectedIndex + 1 : 0;
  }
}

/** Get the currently highlighted completion item, or null if the list is empty. */
export function getSelectedItem(state: AutocompleteState): CompletionItem | null {
  if (state.filtered.length === 0) return null;
  return state.filtered[state.selectedIndex];
}

// --- Terminal rendering -----------------------------------------------------

/** Render the autocomplete menu below the current cursor position. */
export function renderMenu(output: Writable, state: AutocompleteState): void {
  // Clear any previously rendered lines first
  clearMenu(output, state);

  if (state.filtered.length === 0) {
    state.renderedLineCount = 0;
    return;
  }

  output.write(SAVE_CURSOR);
  for (let i = 0; i < state.filtered.length; i++) {
    const item = state.filtered[i];
    const isSelected = i === state.selectedIndex;
    if (isSelected) {
      output.write(
        `\n${CLEAR_LINE}  ${YELLOW}> /${item.name}${RESET} ${DIM}— ${item.description}${RESET}`,
      );
    } else {
      output.write(`\n${CLEAR_LINE}  ${DIM}  /${item.name} — ${item.description}${RESET}`);
    }
  }
  output.write(RESTORE_CURSOR);
  state.renderedLineCount = state.filtered.length;
}

/** Clear previously rendered menu lines from the terminal. */
export function clearMenu(output: Writable, state: AutocompleteState): void {
  if (state.renderedLineCount === 0) return;
  output.write(SAVE_CURSOR);
  for (let i = 0; i < state.renderedLineCount; i++) {
    output.write(`\n${CLEAR_LINE}`);
  }
  output.write(RESTORE_CURSOR);
  state.renderedLineCount = 0;
}
