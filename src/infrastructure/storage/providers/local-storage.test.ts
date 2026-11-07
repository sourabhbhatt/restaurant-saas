import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe } from "vitest";

import { runObjectStorageContract } from "../object-storage.contract";
import { createLocalStorage } from "./local-storage";

describe("local storage", () => {
  runObjectStorageContract(async () =>
    createLocalStorage(await mkdtemp(path.join(tmpdir(), "ros-storage-"))),
  );
});
