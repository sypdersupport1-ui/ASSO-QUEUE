import { describe, it, expect } from 'vitest';
import {
  resolveSafeRedirect,
  dashboardPathForRole,
  selectInvitableMemberships,
} from '@/lib/services/staff-invitation-service';
import {
  createStaffSchema,
  INVITABLE_STAFF_ROLES,
} from '@/lib/services/restaurant-admin-service';
import {
  generateStaffInviteIdentifier,
  generateStaffResendIdentifier,
  fingerprintQueueToken,
} from '@/lib/rate-limit';

describe('Phase 3C: Invitation redirect safety (no open redirects)', () => {
  it('allows the onboarding page', () => {
    expect(resolveSafeRedirect('/auth/accept-invitation')).toBe(
      '/auth/accept-invitation'
    );
  });

  it('allows dashboard destinations', () => {
    expect(resolveSafeRedirect('/dashboard')).toBe('/dashboard');
    expect(resolveSafeRedirect('/dashboard/operational')).toBe(
      '/dashboard/operational'
    );
    expect(resolveSafeRedirect('/login')).toBe('/login');
  });

  it('rejects absolute attacker URLs', () => {
    expect(resolveSafeRedirect('https://attacker.com')).toBe(
      '/auth/accept-invitation'
    );
    expect(resolveSafeRedirect('https://attacker.com/dashboard')).toBe(
      '/auth/accept-invitation'
    );
  });

  it('rejects protocol-relative and non-allowlisted paths', () => {
    expect(resolveSafeRedirect('//evil.com/phish')).toBe(
      '/auth/accept-invitation'
    );
    expect(resolveSafeRedirect('/platform/settings')).toBe(
      '/auth/accept-invitation'
    );
    expect(resolveSafeRedirect('/q/some-slug')).toBe('/auth/accept-invitation');
  });

  it('falls back for missing / malformed input', () => {
    expect(resolveSafeRedirect(null)).toBe('/auth/accept-invitation');
    expect(resolveSafeRedirect(undefined)).toBe('/auth/accept-invitation');
    expect(resolveSafeRedirect('')).toBe('/auth/accept-invitation');
    expect(resolveSafeRedirect('javascript:alert(1)')).toBe(
      '/auth/accept-invitation'
    );
  });
});

describe('Phase 3C: Role model (no SUPER_ADMIN grant)', () => {
  it('invitable roles are exactly STAFF and RESTAURANT_ADMIN', () => {
    expect([...INVITABLE_STAFF_ROLES]).toEqual([
      'STAFF',
      'RESTAURANT_ADMIN',
    ]);
    expect(INVITABLE_STAFF_ROLES).not.toContain('SUPER_ADMIN');
  });

  it('schema rejects SUPER_ADMIN invitations', () => {
    const result = createStaffSchema.safeParse({
      email: 'evil@example.com',
      displayName: 'Evil Admin',
      role: 'SUPER_ADMIN',
    });
    expect(result.success).toBe(false);
  });

  it('schema accepts STAFF and RESTAURANT_ADMIN, defaults to STAFF', () => {
    const staff = createStaffSchema.safeParse({
      email: 's@example.com',
      displayName: 'Staff',
      role: 'STAFF',
    });
    expect(staff.success).toBe(true);

    const admin = createStaffSchema.safeParse({
      email: 'a@example.com',
      displayName: 'Admin',
      role: 'RESTAURANT_ADMIN',
    });
    expect(admin.success).toBe(true);

    const def = createStaffSchema.safeParse({
      email: 'd@example.com',
      displayName: 'Default',
    });
    expect(def.success).toBe(true);
    if (def.success) expect(def.data.role).toBe('STAFF');
  });

  it('schema has no password field (never emailed/stored)', () => {
    const shape = Object.keys(createStaffSchema.shape);
    expect(shape).toEqual(
      expect.arrayContaining(['email', 'displayName', 'role'])
    );
    expect(shape).not.toContain('password');
  });

  it('tampered role values are rejected', () => {
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'OWNER', '']) {
      const result = createStaffSchema.safeParse({
        email: 'x@example.com',
        displayName: 'X Y',
        role,
      });
      expect(result.success).toBe(false);
    }
  });
});

describe('Phase 3C: Invitation scoping (tenant safety)', () => {
  const invited = [
    { id: 'm1', user_id: 'u1', restaurant_id: 'rA', role: 'STAFF', status: 'INVITED' },
    { id: 'm2', user_id: 'u1', restaurant_id: 'rB', role: 'STAFF', status: 'INVITED' },
    { id: 'm3', user_id: 'u1', restaurant_id: 'rA', role: 'STAFF', status: 'ACTIVE' },
    { id: 'm4', user_id: 'u2', restaurant_id: 'rA', role: 'STAFF', status: 'INVITED' },
  ];

  it('scopes to the invited restaurant from Auth metadata', () => {
    // The service always pre-filters to the authenticated user's own rows;
    // the pure selector then narrows to the invited restaurant.
    const own = invited.filter((m) => m.user_id === 'u1');
    const eligible = selectInvitableMemberships(own, 'rA');
    expect(eligible.map((m) => m.id)).toEqual(['m1']);
  });

  it('includes only INVITED rows (user scoping happens in the service query)', () => {
    const own = invited.filter((m) => m.user_id === 'u1');
    const eligible = selectInvitableMemberships(own, null);
    expect(eligible.map((m) => m.id).sort()).toEqual(['m1', 'm2']);
  });

  it('returns empty when metadata points at an unrelated restaurant', () => {
    const own = invited.filter((m) => m.user_id === 'u1');
    expect(selectInvitableMemberships(own, 'rZZZ')).toEqual([]);
  });

  it('dashboard path follows the granted role', () => {
    expect(dashboardPathForRole('STAFF')).toBe('/dashboard/operational');
    expect(dashboardPathForRole('RESTAURANT_ADMIN')).toBe('/dashboard');
    expect(dashboardPathForRole('SUPER_ADMIN')).toBe('/platform');
    expect(dashboardPathForRole(null)).toBe('/dashboard/operational');
  });
});

describe('Phase 3C: Invitation rate-limit keys', () => {
  it('create key is restaurant+actor scoped (tenant isolated)', () => {
    const a = generateStaffInviteIdentifier('restA', 'actor1');
    const b = generateStaffInviteIdentifier('restB', 'actor1');
    expect(a).toBe('rl:staff:invite:restA:actor1');
    expect(a).not.toBe(b);
  });

  it('resend key is per-target-membership', () => {
    expect(generateStaffResendIdentifier('mem1')).toBe('rl:staff:resend:mem1');
    expect(generateStaffResendIdentifier('mem1')).not.toBe(
      generateStaffResendIdentifier('mem2')
    );
  });

  it('raw tokens never appear in limiter keys', () => {
    const raw = 'qtoken_' + 'a'.repeat(64);
    const fp = fingerprintQueueToken(raw);
    expect(fp).not.toContain(raw);
    expect(fp).toHaveLength(64);
  });
});
