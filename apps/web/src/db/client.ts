import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://haddon:haddon@127.0.0.1:5433/haddon";

const globalForDb = globalThis as typeof globalThis & {
  __haddonSql?: ReturnType<typeof postgres>;
};

const sql =
  globalForDb.__haddonSql ??
  postgres(connectionString, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__haddonSql = sql;
}

export const db = drizzle(sql, { schema });
