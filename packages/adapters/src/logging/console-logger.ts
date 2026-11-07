import type { ErrorReporter, LogFields, Logger } from "@ros/application/ports/observability";

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Keys whose values are always redacted, wherever they appear. */
const SENSITIVE = /pass(word)?|token|secret|authorization|cookie|api[-_]?key|hash/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || typeof value !== "object") return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE.test(k) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

/** JSON-lines logger to stdout/stderr. Works on any host; log drains can ingest it. */
export function createConsoleLogger(level: Level = "info", base: LogFields = {}): Logger {
  const write = (lvl: Level, message: string, fields?: LogFields) => {
    if (ORDER[lvl] < ORDER[level]) return;
    const line = JSON.stringify({
      level: lvl,
      time: new Date().toISOString(),
      msg: message,
      ...(redact({ ...base, ...fields }) as LogFields),
    });
    if (lvl === "error" || lvl === "warn") console.error(line);
    else console.log(line);
  };
  return {
    debug: (m, f) => write("debug", m, f),
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
    child: (fields) => createConsoleLogger(level, { ...base, ...fields }),
  };
}

export function createLogErrorReporter(logger: Logger): ErrorReporter {
  return {
    capture(error, context) {
      logger.error("unhandled_error", { ...context, error });
    },
  };
}

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};
