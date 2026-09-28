// A diagnostics log the user can hand back after something goes wrong on a real device, since a
// crash on a production build leaves nothing else behind. Capped and persisted: the last
// MAX_LINES lines live in memory and mirror to a file, so they survive a restart.
const MAX_LINES = 300;

let lines: string[] = [];
let loaded = false;
let installed = false;

function logFile(): { exists: boolean; textSync(): string; write(value: string): void } | null {
  try {
    // Lazy require, not a module-scope import: this module is imported by app code that Jest
    // also loads, and expo-file-system has no Node implementation.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { File, Paths } = require('expo-file-system');
    return new File(Paths.document, 'mmyway.log');
  } catch {
    return null;
  }
}

function persist(): void {
  const file = logFile();
  if (!file) return;
  try {
    file.write(lines.join('\n'));
  } catch {
    // A diagnostics log must never be the reason something fails.
  }
}

/** Reads the log back, including whatever a previous run left behind. */
export function readLog(): string[] {
  if (!loaded) {
    loaded = true;
    const file = logFile();
    try {
      // textSync, not text(): text() returns a promise, so the previous run's lines were never
      // read back (and a missing file became an unhandled rejection).
      const existing = file?.exists ? file.textSync() : null;
      if (existing) lines = existing.split('\n').slice(-MAX_LINES);
    } catch {
      // No log file yet.
    }
  }
  return lines;
}

export function logLine(level: 'info' | 'warn' | 'error', message: string): void {
  readLog();
  lines = [...lines, `${new Date().toISOString()} ${level.toUpperCase()} ${message}`].slice(-MAX_LINES);
  persist();
}

const REDACTED_KEYS = ['description', 'notes', 'name', 'source_name', 'destination_name', 'category_name', 'budget_name', 'tags', 'group_title', 'rawInput', 'targetName'];

/**
 * The log as it may leave the phone (Share): amounts and the text fields that name payees,
 * accounts and notes are masked, so a bug report doesn't carry someone's finances with it.
 */
export function shareableLog(source: string[] = readLog()): string {
  const keys = REDACTED_KEYS.join('|');
  return source.join('\n')
    .replace(new RegExp(`("(?:${keys})"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*"|\\[[^\\]]*\\])`, 'g'), '$1"‹redacted›"')
    .replace(/-?\d[\d\s]*[.,]\d{1,2}(?!\d)/g, '‹amount›');
}

export function clearLog(): void {
  loaded = true;
  lines = [];
  persist();
}

function describe(args: unknown[]): string {
  return args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack ?? ''}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
}

/** Mirrors console.warn/error into the log, so a stray throw is captured without new call sites. */
export function installLogCapture(): void {
  if (installed) return;
  installed = true;
  for (const level of ['warn', 'error'] as const) {
    const original = console[level];
    console[level] = (...args: unknown[]) => {
      try {
        logLine(level, describe(args));
      } catch {
        // Never let logging break the thing being logged.
      }
      original(...args);
    };
  }
}
