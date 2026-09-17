import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Guard: scheduling must stay FREE (pg_cron inside Postgres).
 * Vercel cron is costly (needs Pro for frequent schedules), so vercel.json
 * must NOT contain a "crons" section. If scheduling is needed, it lives in
 * supabase/migrations/20260922000000_phase3a_pg_cron.sql (pg_cron, free).
 */
describe('Scheduler cost guard', () => {
  it('vercel.json has no crons section', () => {
    const vercelPath = path.resolve(__dirname, '../../vercel.json');
    const raw = fs.readFileSync(vercelPath, 'utf8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    expect(config).not.toHaveProperty('crons');
  });

  it('pg_cron migration exists for free scheduling', () => {
    const migPath = path.resolve(
      __dirname,
      '../../supabase/migrations/20260922000000_phase3a_pg_cron.sql'
    );
    expect(fs.existsSync(migPath)).toBe(true);
    const sql = fs.readFileSync(migPath, 'utf8');
    expect(sql).toContain('queue-maintenance-every-minute');
    expect(sql).toContain('expire_overdue_called_queue_entries');
  });
});
