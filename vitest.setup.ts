import "@testing-library/jest-dom/vitest";
// In-memory IndexedDB so Dexie-based code can be unit tested in jsdom.
import "fake-indexeddb/auto";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
