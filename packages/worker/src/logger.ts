/**
 * Minimal structured logger.
 *
 * The worker has no logging dependency so that this file can enforce one rule
 * everywhere: **nothing that looks like a credential leaves the process**. Applying
 * redaction at a single choke point is the only way to be confident about that;
 * per-call-site discipline is not.
 */

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type LogLevel = keyof typeof LEVELS;

/** Field names whose values must never be logged. */
const REDACTED_KEYS = [
  'apikey',
  'api_key',
  'authorization',
  'cookie',
  'mnemonic',
  'password',
  'privatekey',
  'private_key',
  'secret',
  'signature',
  'signeddata',
  'signed_data',
  'token',
  'webhooksecret',
  'webhook_secret',
];

const REDACTED = '[redacted]';

/**
 * Recursively redact credential-bearing fields.
 * Depth-limited so a circular or pathologically nested object cannot hang the worker.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]';
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACTED_KEYS.includes(key.toLowerCase()) ? REDACTED : redact(nested, depth + 1);
    }
    return out;
  }

  // A bare string that looks like a private key never gets logged, whatever the key name was.
  if (typeof value === 'string' && /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) {
    return REDACTED;
  }

  return value;
}

export function createLogger(level: LogLevel = 'info', pretty = false): Logger {
  const threshold = LEVELS[level];

  const emit = (levelName: LogLevel, message: string, fields?: Record<string, unknown>): void => {
    if (LEVELS[levelName] < threshold) return;

    const entry = {
      level: levelName,
      time: new Date().toISOString(),
      service: 'worker',
      message,
      ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
    };

    const line = pretty
      ? `${entry.time} ${levelName.toUpperCase().padEnd(5)} ${message}${
          fields ? ` ${JSON.stringify(redact(fields))}` : ''
        }`
      : JSON.stringify(entry);

    // A logger is the one place that must write to the console.
    /* eslint-disable no-console */
    if (levelName === 'error') console.error(line);
    else if (levelName === 'warn') console.warn(line);
    else console.log(line);
    /* eslint-enable no-console */
  };

  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}
