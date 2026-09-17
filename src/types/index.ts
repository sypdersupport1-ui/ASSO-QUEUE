export * from '@/lib/config/env';
export * from '@/lib/errors';
export * from '@/lib/auth/roles';
export * from '@/lib/logging/logger';
export * from '@/lib/services/base';
export * from '@/lib/validation';
export * from '@/types/database.types';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  meta?: {
    correlationId?: string;
    timestamp: string;
  };
}
