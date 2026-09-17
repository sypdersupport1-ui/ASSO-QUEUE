import { describe, it, expect } from 'vitest';
import { getUserRole } from '@/lib/auth/roles';
import type { User } from '@supabase/supabase-js';

describe('Authorization Foundation', () => {
  it('should extract SUPER_ADMIN role correctly from user app_metadata', () => {
    const mockUser: Partial<User> = {
      id: 'usr_1',
      app_metadata: { role: 'SUPER_ADMIN' },
    };

    const role = getUserRole(mockUser as User);
    expect(role).toBe('SUPER_ADMIN');
  });

  it('should extract RESTAURANT_ADMIN role correctly from user user_metadata fallback', () => {
    const mockUser: Partial<User> = {
      id: 'usr_2',
      user_metadata: { role: 'RESTAURANT_ADMIN' },
    };

    const role = getUserRole(mockUser as User);
    expect(role).toBe('RESTAURANT_ADMIN');
  });

  it('should return null for invalid or missing roles', () => {
    const mockUser: Partial<User> = {
      id: 'usr_3',
      user_metadata: { role: 'INVALID_ROLE' },
    };

    const role = getUserRole(mockUser as User);
    expect(role).toBeNull();
  });
});
