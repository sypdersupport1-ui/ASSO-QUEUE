import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import fs from 'fs';
import path from 'path';
import { Client } from 'pg';

async function run() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set in .env.local');
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const migrationPath = path.join(
      process.cwd(),
      'supabase/migrations/20260912000008_phase13_notifications_outbox.sql'
    );
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log('Applying Phase 13 migration (20260912000008_phase13_notifications_outbox.sql)...');
    await client.query(sql);
    console.log('Phase 13 migration applied successfully!');
  } catch (err) {
    console.error('Failed to apply migration:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
