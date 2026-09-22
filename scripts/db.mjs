// Run a .sql file (or an inline statement) against the project database.
//
//   node scripts/db.mjs supabase/seed/kitty.sql
//   node scripts/db.mjs -e "insert into public.admins (email) values ('you@example.com')"
//
// Uses SUPABASE_DB_URL from .env.local: the direct connection string from
// Supabase → Project Settings → Database. Local only; never deploy it. If the
// direct host is IPv6-only and your network is not, use the Session pooler
// string from the same page instead.
//
// For seeds and one-off admin tasks. Schema changes are migrations in
// supabase/migrations/, applied in order and never edited afterwards.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvLocal() {
  const file = join(root, ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
}

loadEnvLocal();
const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("SUPABASE_DB_URL is not set (add it to .env.local).");
  process.exit(1);
}

const args = process.argv.slice(2);
let sql;
if (args[0] === "-e" && args[1]) sql = args[1];
else if (args[0] && existsSync(args[0])) sql = readFileSync(args[0], "utf8");
else {
  console.error("usage: node scripts/db.mjs <file.sql> | -e \"<sql>\"");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  const result = await client.query(sql);
  const results = Array.isArray(result) ? result : [result];
  const withRows = results.filter((r) => r?.rows?.length && r.command === "SELECT");
  if (withRows.length) for (const r of withRows) console.table(r.rows);
  else console.log(`ok (${results[results.length - 1]?.command ?? "done"})`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
