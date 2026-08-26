// Append-only JSONL audit trail for an always-on host: pairing attempts,
// every write method, revocations. Size-rotated (1 file back).
import * as fs from "fs";

const MAX_BYTES = 5 * 1024 * 1024;

export class AuditLog {
  constructor(private file: string) {}

  write(event: string, fields: Record<string, unknown>): void {
    const line = JSON.stringify({ ts: new Date().toISOString(), event, ...fields }) + "\n";
    try {
      try { if (fs.statSync(this.file).size > MAX_BYTES) fs.renameSync(this.file, this.file + ".1"); } catch { /* first write */ }
      fs.appendFileSync(this.file, line, { mode: 0o600 });
    } catch { /* audit must never take the daemon down */ }
  }

  tail(n = 50): string[] {
    try {
      const lines = fs.readFileSync(this.file, "utf8").trimEnd().split("\n");
      return lines.slice(-n);
    } catch { return []; }
  }
}
