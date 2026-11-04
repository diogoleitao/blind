import type { StateStore } from "./ports";
import type { CoreState } from "./state";

export function createInMemoryStateStore(): StateStore {
  let snapshot: CoreState | undefined;
  return {
    load: () => snapshot,
    save: (next) => {
      snapshot = next;
    },
  };
}
