import { appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import { ensurePrivateDir } from "./fsutil.js";
import type { Redactor } from "./redact.js";

export type Tier = "T0" | "T1" | "T2" | "T3";
export type Decision =
  | "allowed"
  | "command-only"
  | "rejected"
  | "disabled"
  | "unavailable"
  | "error";

export interface AuditEntry {
  /** Origen de la llamada. Las líneas antiguas no lo traen (eran siempre del servidor MCP). */
  source?: "cli" | "mcp";
  tool: string;
  project?: string;
  env?: string;
  tier: Tier;
  decision: Decision;
  exit_code?: number | null;
  /** Operaciones que cambian algo: `intent` se escribe ANTES del cambio (exit_code null) y `result` al terminar. Ausente en el resto. */
  phase?: "intent" | "result";
  duration_ms: number;
  /** Argumentos de la herramienta; se redactan y recortan antes de escribir. */
  args?: unknown;
}

const MAX_ARG_STRING = 200;

function clip(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return v.length > MAX_ARG_STRING ? v.slice(0, MAX_ARG_STRING) + "…" : v;
  if (depth > 4) return "…";
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => clip(x, depth + 1));
  if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v).slice(0, 30).map(([k, x]) => [k, clip(x, depth + 1)]));
  return v;
}

/** Registro append-only en JSONL (0600, directorio 0700). */
export class AuditLog {
  constructor(
    private readonly file: string,
    private readonly redactor: Redactor,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    await ensurePrivateDir(dirname(this.file));
    const { args, ...rest } = entry;
    const line = {
      time: this.now().toISOString(),
      ...rest,
      ...(args === undefined ? {} : { args: this.redactor.redactValue(clip(args)) }),
    };
    await appendFile(this.file, JSON.stringify(line) + "\n", { mode: 0o600, flag: "a" });
  }
}
