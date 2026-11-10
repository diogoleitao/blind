import type { Snapshot, StateStore } from "./ports";

export function createInMemoryStateStore(): StateStore {
  let snapshot: Snapshot | undefined;
  return {
    load: () => snapshot,
    save: (next) => {
      snapshot = next;
    },
    flush: () => {},
  };
}
