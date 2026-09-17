import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  correlationId: string;
  userId?: string;
  restaurantId?: string;
  path?: string;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Execute a callback within a request context context.
 */
export function runWithRequestContext<T>(
  context: RequestContext,
  callback: () => T
): T {
  return asyncLocalStorage.run(context, callback);
}

/**
 * Retrieve the current request correlation context.
 */
export function getRequestContext(): RequestContext | undefined {
  return asyncLocalStorage.getStore();
}
