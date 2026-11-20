// Applies db/schema.sql once. Safe to run on every deploy: it skips if the schema already exists.
import fs from 'node:fs';
import pg from 'pg';

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const { rows } = await c.query("SELECT to_regclass('public.users') AS t");
if (rows[0].t) {
  console.log('Schema already applied');
} else {
  await c.query(fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  console.log('Schema applied');
}
await c.end();
