import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fail, loadEnvFile, projectRoot } from "./lib/env.mjs";

const psqlPath = "/Library/PostgreSQL/17/bin/psql";

loadEnvFile();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  fail("DATABASE_URL is not configured. Add it to .env.local first.");
}

if (!existsSync(psqlPath)) {
  fail(`psql was not found at ${psqlPath}`);
}

run(psqlPath, [
  databaseUrl,
  "-c",
  `
    SELECT
      id,
      full_name,
      phone,
      booking_date,
      booking_time,
      skill_level,
      boot_size,
      status,
      created_at
    FROM bookings
    ORDER BY created_at DESC
    LIMIT 20;
  `,
]);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
  });

  if (result.error) {
    fail(result.error.message);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
