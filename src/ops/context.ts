import { AuditLog } from "../core/audit.js";
import { exec, type Runner } from "../core/exec.js";
import { LogStore } from "../core/output.js";
import { auditFile, logsDir, type Paths } from "../core/paths.js";
import { Redactor } from "../core/redact.js";
import { fileURLToPath } from "node:url";

/** templates/ del paquete (src/ops o dist/ops => ../../templates). */
export const DEFAULT_TEMPLATES_DIR = fileURLToPath(new URL("../../templates", import.meta.url));

export interface Ctx {
  paths: Paths;
  runner: Runner;
  redactor: Redactor;
  logs: LogStore;
  audit: AuditLog;
  templatesDir: string;
  now: () => Date;
}

export interface ToolOutcome {
  text: string;
  isError: boolean;
  decision: "allowed" | "command-only" | "rejected" | "disabled" | "unavailable" | "error";
  project?: string;
  env?: string;
  exitCode?: number | null;
}

export function createContext(paths: Paths, overrides: Partial<Pick<Ctx, "runner" | "redactor" | "templatesDir" | "now">> = {}): Ctx {
  const redactor = overrides.redactor ?? new Redactor();
  return {
    paths,
    runner: overrides.runner ?? exec,
    redactor,
    logs: new LogStore(logsDir(paths), redactor),
    audit: new AuditLog(auditFile(paths), redactor),
    templatesDir: overrides.templatesDir ?? DEFAULT_TEMPLATES_DIR,
    now: overrides.now ?? (() => new Date()),
  };
}
