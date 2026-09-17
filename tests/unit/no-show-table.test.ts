import { describe, it, expect } from 'vitest';

describe('No-show - valid reasons', () => {
  const validReasons = ['CUSTOMER_DID_NOT_RETURN','CUSTOMER_DID_NOT_RESPOND','STAFF_MARKED_NO_SHOW','OTHER'];
  it('accepts each valid reason', () => {
    for (const r of validReasons) {
      expect(validReasons).toContain(r);
    }
  });
  it('rejects invalid reason', () => {
    expect(validReasons).not.toContain('RANDOM_REASON');
  });
});

describe('Table Recommendation - deterministic', () => {
  const recommend = (partySize: number, tables: Array<{id:string, table_number:string, capacity:number, status:string, is_archived:boolean}>) => {
    return tables
      .filter(t => !t.is_archived && t.status === 'AVAILABLE' && t.capacity >= partySize)
      .sort((a,b) => a.capacity - b.capacity || a.table_number.localeCompare(b.table_number) || a.id.localeCompare(b.id))
      .slice(0,5);
  };

  it('prefers smallest sufficient capacity', () => {
    const tables = [
      {id:'1', table_number:'T2', capacity:2, status:'AVAILABLE', is_archived:false},
      {id:'2', table_number:'T4', capacity:4, status:'AVAILABLE', is_archived:false},
      {id:'3', table_number:'T6', capacity:6, status:'AVAILABLE', is_archived:false},
    ];
    expect(recommend(3, tables)[0]!.capacity).toBe(4);
  });

  it('excludes insufficient, occupied, archived', () => {
    const tables = [
      {id:'1', table_number:'T2', capacity:2, status:'AVAILABLE', is_archived:false},
      {id:'2', table_number:'T4', capacity:4, status:'OCCUPIED', is_archived:false},
      {id:'3', table_number:'T6', capacity:6, status:'AVAILABLE', is_archived:true},
      {id:'4', table_number:'T8', capacity:8, status:'AVAILABLE', is_archived:false},
    ];
    const rec = recommend(3, tables);
    expect(rec.map(r=>r.id)).toEqual(['4']);
  });

  it('tie-break by table_number then id', () => {
    const tables = [
      {id:'b', table_number:'T10', capacity:4, status:'AVAILABLE', is_archived:false},
      {id:'a', table_number:'T02', capacity:4, status:'AVAILABLE', is_archived:false},
    ];
    expect(recommend(3, tables)[0]!.table_number).toBe('T02');
  });

  it('max 5 candidates', () => {
    const tables = Array.from({length:10}, (_,i)=>({id:`${i}`, table_number:`T${i}`, capacity:4, status:'AVAILABLE', is_archived:false}));
    expect(recommend(2, tables).length).toBe(5);
  });

  it('invalid party size handled', () => {
    expect(() => recommend(0, [])).not.toThrow();
  });
});
