import { describe, it, expect } from 'vitest';
import { TableService } from '@/lib/services/table-service';

describe('Queue page degrade-gracefully fallbacks', () => {
  it('emptyTablesResult matches the listTables result shape with zeroed values', () => {
    const empty = TableService.emptyTablesResult();

    expect(empty.tables).toEqual([]);
    expect(empty.total).toBe(0);
    expect(empty.totalPages).toBe(0);
    expect(empty.stats).toEqual({
      total: 0,
      available: 0,
      occupied: 0,
      cleaning: 0,
      reserved: 0,
      outOfService: 0,
    });
  });

  it('empty tables result supports the queue page read patterns without throwing', () => {
    const tablesRes = TableService.emptyTablesResult();

    // Mirrors src/app/dashboard/queue/page.tsx derivations
    const tables = tablesRes.tables as Array<{ status: string }>;
    expect(tables.filter((t) => t.status === 'AVAILABLE').length).toBe(0);
    expect(tablesRes.stats.total).toBe(0);
    expect(tablesRes.stats.available).toBe(0);
    expect(tablesRes.stats.occupied).toBe(0);
    expect(tables.filter((t) => t.status === 'CLEANING').length).toBe(0);
    expect(tables.filter((t) => t.status === 'RESERVED').length).toBe(0);
  });
});
