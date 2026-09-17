import { describe, it, expect } from 'vitest';

describe('Queue Health - State Classification', () => {
  const getHealth = (active: number, max: number, overhead: number, operatingState: string, queueEnabled: boolean, availableTables: number) => {
    const isFull = active >= max;
    let health: string = 'HEALTHY';
    let reason = 'Queue is healthy';
    if (!queueEnabled || operatingState === 'CLOSED') { health = 'CLOSED'; reason = 'Queue is closed'; }
    else if (operatingState === 'PAUSED') { health = 'PAUSED'; reason = 'Queue is paused'; }
    else if (active === 0) { health = 'EMPTY'; reason = 'No active queue'; }
    else if (active >= max * 0.9 || overhead > 0 || (active > 0 && availableTables === 0)) {
      health = 'CRITICAL';
      if (overhead > 0) reason = `${overhead} overdue called`;
      else if (availableTables === 0) reason = 'No available tables';
      else reason = `Queue ${Math.round(active/max*100)}% full`;
    } else if (active >= max * 0.6) { health = 'BUSY'; reason = `Queue ${Math.round(active/max*100)}% full`; }
    return { health, reason, isFull };
  };

  it('EMPTY when active 0 and open', () => {
    expect(getHealth(0, 100, 0, 'OPEN', true, 5).health).toBe('EMPTY');
  });
  it('CLOSED when operating CLOSED', () => {
    expect(getHealth(5, 100, 0, 'CLOSED', true, 5).health).toBe('CLOSED');
  });
  it('PAUSED when operating PAUSED', () => {
    expect(getHealth(5, 100, 0, 'PAUSED', true, 5).health).toBe('PAUSED');
  });
  it('CRITICAL when >=90% full', () => {
    expect(getHealth(95, 100, 0, 'OPEN', true, 5).health).toBe('CRITICAL');
  });
  it('CRITICAL when overdue >0', () => {
    expect(getHealth(10, 100, 2, 'OPEN', true, 5).health).toBe('CRITICAL');
  });
  it('CRITICAL when no available tables but active >0', () => {
    expect(getHealth(10, 100, 0, 'OPEN', true, 0).health).toBe('CRITICAL');
  });
  it('BUSY when >=60% full', () => {
    expect(getHealth(65, 100, 0, 'OPEN', true, 5).health).toBe('BUSY');
  });
  it('HEALTHY otherwise', () => {
    expect(getHealth(10, 100, 0, 'OPEN', true, 5).health).toBe('HEALTHY');
  });
  it('FULL derived', () => {
    expect(getHealth(100, 100, 0, 'OPEN', true, 5).isFull).toBe(true);
    expect(getHealth(99, 100, 0, 'OPEN', true, 5).isFull).toBe(false);
  });
  it('priority CLOSED > PAUSED > CRITICAL > BUSY', () => {
    // CLOSED should win even if also CRITICAL
    expect(getHealth(95, 100, 5, 'CLOSED', true, 0).health).toBe('CLOSED');
    expect(getHealth(95, 100, 5, 'PAUSED', true, 0).health).toBe('PAUSED');
  });
});

describe('Queue Position - active excludes terminal', () => {
  it('active is WAITING/NOTIFIED/CALLED only', () => {
    const statuses = ['WAITING','NOTIFIED','CALLED','SEATED','CANCELLED','NO_SHOW','EXPIRED','COMPLETED','REMOVED','SKIPPED'];
    const active = statuses.filter(s => ['WAITING','NOTIFIED','CALLED'].includes(s));
    expect(active).toEqual(['WAITING','NOTIFIED','CALLED']);
    const terminal = statuses.filter(s => !['WAITING','NOTIFIED','CALLED'].includes(s));
    expect(terminal).toContain('SEATED');
    expect(terminal).toContain('NO_SHOW');
  });
});
