import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function run() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL missing in .env.local');
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to Supabase PostgreSQL database');

  const migrationPath = path.join(process.cwd(), 'supabase/migrations/20260910000002_phase6_restaurant_setup.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  await client.query(sql);
  console.log('Successfully executed 20260910000002_phase6_restaurant_setup.sql');

  await client.end();
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
