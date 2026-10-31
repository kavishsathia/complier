import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

// Durable aggregate spend admission for live model calls. Before a call, its worst case (all of its
// input and max_tokens of output at the configured prices) is reserved against the cap in a file;
// after it, the reservation is replaced by what the provider reported using (or the worst case, if it
// reported nothing). A crash leaves the reservation counted, so the cap errs towards spending less.
// Amounts are integer micro-dollars. One file, one host: serverless instances would each need it.

export type SpendFile = { cap_micros: number; spent_micros: number; reserved_micros: number; calls: number };

export class SpendGuard {
  private readonly file: string;
  private readonly cap: number;

  constructor(file: string, capMicros: number) {
    if (!Number.isSafeInteger(capMicros) || capMicros <= 0) throw new Error("spend cap must be a positive whole number of micro-dollars");
    this.file = file;
    this.cap = capMicros;
  }

  private locked<T>(f: () => T): T {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const lock = `${this.file}.lock`;
    const until = Date.now() + 2_000;
    for (;;) {
      try {
        closeSync(openSync(lock, "wx"));
        break;
      } catch {
        // A lock older than 10 s belongs to a process that died holding it.
        try {
          if (Date.now() - statSync(lock).mtimeMs > 10_000) rmSync(lock, { force: true });
        } catch {}
        if (Date.now() > until) throw new Error("spend ledger is busy");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      }
    }
    try {
      return f();
    } finally {
      rmSync(lock, { force: true });
    }
  }

  read(): SpendFile {
    if (!existsSync(this.file)) return { cap_micros: this.cap, spent_micros: 0, reserved_micros: 0, calls: 0 };
    const s = JSON.parse(readFileSync(this.file, "utf8")) as SpendFile;
    for (const k of ["spent_micros", "reserved_micros", "calls"] as const) {
      if (!Number.isSafeInteger(s[k]) || s[k] < 0) throw new Error(`spend ledger ${this.file} is corrupt (${k})`);
    }
    return { ...s, cap_micros: this.cap };
  }

  private write(s: SpendFile) {
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(s));
    renameSync(tmp, this.file);
  }

  // Reserves worstMicros, or refuses if the cap would be exceeded.
  admit(worstMicros: number): { ok: true } | { ok: false; reason: string } {
    if (!Number.isSafeInteger(worstMicros) || worstMicros <= 0) throw new Error("worst case must be a positive whole number of micro-dollars");
    return this.locked(() => {
      const s = this.read();
      if (s.spent_micros + s.reserved_micros + worstMicros > this.cap) {
        return { ok: false as const, reason: "the live model's spending cap for this game is used up" };
      }
      this.write({ ...s, reserved_micros: s.reserved_micros + worstMicros });
      return { ok: true as const };
    });
  }

  settle(worstMicros: number, actualMicros: number | undefined) {
    this.locked(() => {
      const s = this.read();
      const charged = actualMicros === undefined || !Number.isSafeInteger(actualMicros) || actualMicros < 0 ? worstMicros : Math.min(actualMicros, worstMicros);
      this.write({ ...s, reserved_micros: Math.max(0, s.reserved_micros - worstMicros), spent_micros: s.spent_micros + charged, calls: s.calls + 1 });
    });
  }
}
