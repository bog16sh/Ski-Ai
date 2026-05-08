import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { fail, loadEnvFile, projectRoot } from "./lib/env.mjs";

const { Client } = pg;

loadEnvFile();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  fail("DATABASE_URL is not configured. Add it to .env.local first.");
}

const targetUrl = new URL(databaseUrl);
const databaseName = decodeURIComponent(targetUrl.pathname.replace(/^\//, ""));

if (!databaseName) {
  fail("DATABASE_URL must include a database name.");
}

const maintenanceUrl = new URL(targetUrl);
maintenanceUrl.pathname = "/postgres";

await ensureDatabase(maintenanceUrl.toString(), databaseName);
await applySchema(databaseUrl);

console.log(`Database "${databaseName}" is ready.`);

async function ensureDatabase(connectionString, name) {
  const client = new Client({ connectionString });

  await client.connect();

  try {
    const result = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [name]
    );

    if (result.rowCount === 0) {
      await client.query(`CREATE DATABASE ${quoteIdentifier(name)}`);
    }
  } finally {
    await client.end();
  }
}

async function applySchema(connectionString) {
  const client = new Client({ connectionString });
  const schema = readFileSync(resolve(projectRoot, "db/schema.sql"), "utf8");

  await client.connect();

  try {
    await client.query(schema);
  } finally {
    await client.end();
  }
}

function quoteIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}
