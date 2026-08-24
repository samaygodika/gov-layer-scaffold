import { afterAll } from "vitest";
import { closeAppPool } from "../src/with-actor.js";

/** withActor()'s pool is module-level; each test file closes it when it finishes. */
afterAll(async () => {
  await closeAppPool();
});
