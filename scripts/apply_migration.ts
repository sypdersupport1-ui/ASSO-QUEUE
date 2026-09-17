import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function run() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL missing');
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to DB');

  const migrationPath = path.join(process.cwd(), 'supabase/migrations/20260912000009_phase14_analytics.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  await client.query(sql);
  console.log('Migration 20260912000009_phase14_analytics.sql successfully executed');

  await client.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
