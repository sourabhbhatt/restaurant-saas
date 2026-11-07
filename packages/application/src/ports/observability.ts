/** Structured logger port. Adapters must never log secrets or full request bodies. */
export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export type LogFields = Record<string, unknown>;

/** Error reporting port (Sentry, etc.). The default adapter writes to the logger. */
export interface ErrorReporter {
  capture(error: unknown, context?: LogFields): void;
}

export interface Clock {
  now(): Date;
}
