import { redactSensitiveData } from './redactor';
import { getRequestContext } from './correlation';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogMetadata {
  operation?: string;
  userId?: string;
  restaurantId?: string;
  correlationId?: string;
  [key: string]: unknown;
}

class Logger {
  private formatLog(level: LogLevel, message: string, meta?: LogMetadata): string {
    const context = getRequestContext();
    const correlationId = meta?.correlationId || context?.correlationId;
    const userId = meta?.userId || context?.userId;
    const restaurantId = meta?.restaurantId || context?.restaurantId;

    const payload = {
      timestamp: new Date().toISOString(),
      level,
      message,
      correlationId: correlationId || null,
      userId: userId || null,
      restaurantId: restaurantId || null,
      operation: meta?.operation || null,
      metadata: meta ? redactSensitiveData(meta) : undefined,
    };

    return JSON.stringify(payload);
  }

  debug(message: string, meta?: LogMetadata): void {
    if (process.env.NODE_ENV !== 'test') {
      console.debug(this.formatLog('debug', message, meta));
    }
  }

  info(message: string, meta?: LogMetadata): void {
    if (process.env.NODE_ENV !== 'test') {
      console.info(this.formatLog('info', message, meta));
    }
  }

  warn(message: string, meta?: LogMetadata): void {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(this.formatLog('warn', message, meta));
    }
  }

  error(message: string, meta?: LogMetadata): void {
    if (process.env.NODE_ENV !== 'test') {
      console.error(this.formatLog('error', message, meta));
    }
  }
}

export const logger = new Logger();
