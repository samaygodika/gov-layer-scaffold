import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const appsDir = join(repoRoot, "apps");
export const governanceDir = join(repoRoot, "reports", "governance");
