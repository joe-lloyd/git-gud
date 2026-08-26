// One-line structured logs. systemd/journald captures stdout; `--json` gives
// machine-readable lines for other collectors.
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  (msg: string, fields?: Record<string, unknown>): void;
  level: (lvl: LogLevel, msg: string, fields?: Record<string, unknown>) => void;
}

export function createLogger(opts: { json?: boolean; minLevel?: LogLevel; sink?: (line: string) => void } = {}): Logger {
  const order: LogLevel[] = ["debug", "info", "warn", "error"];
  const min = order.indexOf(opts.minLevel ?? "info");
  const sink = opts.sink ?? ((l: string) => process.stdout.write(l + "\n"));
  const level = (lvl: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (order.indexOf(lvl) < min) return;
    if (opts.json) { sink(JSON.stringify({ ts: new Date().toISOString(), level: lvl, msg, ...(fields ?? {}) })); return; }
    const extra = fields && Object.keys(fields).length ? " " + Object.entries(fields).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ") : "";
    sink(`${new Date().toISOString()} ${lvl.padEnd(5)} ${msg}${extra}`);
  };
  const fn = ((msg: string, fields?: Record<string, unknown>) => level("info", msg, fields)) as Logger;
  fn.level = level;
  return fn;
}
