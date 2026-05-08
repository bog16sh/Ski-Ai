import { Pool } from "pg";

declare global {
  var aiFrontdeskPgPool: Pool | undefined;
}

function getConnectionString() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  return connectionString;
}

export function getPool() {
  if (!globalThis.aiFrontdeskPgPool) {
    globalThis.aiFrontdeskPgPool = new Pool({
      connectionString: getConnectionString(),
    });
  }

  return globalThis.aiFrontdeskPgPool;
}
