import { config } from "dotenv";

config();

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
