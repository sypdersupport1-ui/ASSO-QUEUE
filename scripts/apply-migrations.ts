import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL is missing in .env.local');
  process.exit(1);
}

async function runMigrations() {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('Connected to Supabase PostgreSQL database successfully.');

    const migrationFile = path.resolve(__dirname, '../supabase/migrations/20260910000000_phase2_schema_and_rls.sql');
    console.log(`Applying migration: ${migrationFile}`);
    const migrationSql = fs.readFileSync(migrationFile, 'utf8');
    await client.query(migrationSql);
    console.log('✓ Migration 20260910000000_phase2_schema_and_rls.sql applied successfully.');

    const seedFile = path.resolve(__dirname, '../supabase/seed.sql');
    console.log(`Applying seed data: ${seedFile}`);
    const seedSql = fs.readFileSync(seedFile, 'utf8');
    await client.query(seedSql);
    console.log('✓ Seed data applied successfully.');

  } catch (error) {
    console.error('Error applying migration or seed SQL:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigrations();
