import { config } from "dotenv";
import { fileURLToPath } from "node:url";

/**
 * The single `.env` lives at the repository root, but workspace scripts such as
 * `npm run dev -w apps/kyc` run with the app directory as cwd, where dotenv's
 * default lookup finds nothing. Resolving the path from this module keeps one
 * `.env` for every entry point regardless of cwd. Values already present in the
 * process environment still win — dotenv does not override.
 */
export const envFile = fileURLToPath(new URL("../../.env", import.meta.url));

config({ path: envFile });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set; copy .env.example to .env`);
  }
  return value;
}

/** Connection used by the application and the tests. Never scaffold_owner. */
export const appDatabaseUrl = (): string => required("DATABASE_URL");

/** Connection used by migrations and dev seeding only. */
export const ownerDatabaseUrl = (): string => required("DATABASE_URL_OWNER");
