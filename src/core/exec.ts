import { spawn } from "node:child_process";

/** Variables heredadas del proceso. Todo lo demás se descarta. */
export const ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "AWS_PROFILE",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "AWS_CONFIG_FILE",
  "AWS_SHARED_CREDENTIALS_FILE",
] as const;

/** Siempre fijadas: que el CLI de AWS nunca abra pager ni prompt interactivo. */
const FORCED_ENV: Record<string, string> = { AWS_PAGER: "", AWS_CLI_AUTO_PROMPT: "off" };

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function buildEnv(
  extra: Record<string, string> = {},
  source: NodeJS.ProcessEnv = process.env,
  allow: readonly string[] = ENV_ALLOWLIST,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of allow) {
    const v = source[name];
    if (v !== undefined) env[name] = v;
  }
  for (const [k, v] of Object.entries(extra)) {
    if (!ENV_NAME.test(k)) throw new Error(`Nombre de variable de entorno inválido: ${k}`);
    if (v.includes("\0")) throw new Error(`Valor inválido para ${k}`);
    env[k] = v;
  }
  return { ...env, ...FORCED_ENV };
}

export interface ExecOptions {
  cwd?: string;
  timeoutMs?: number;
  /** Adiciones por llamada sobre la allowlist. */
  env?: Record<string, string>;
  /** Origen del que se hereda la allowlist (por defecto process.env; útil en tests). */
  inheritFrom?: NodeJS.ProcessEnv;
  maxOutputBytes?: number;
}

export interface ExecResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
  /** Fallo al lanzar (p. ej. ENOENT). */
  spawnError?: string;
}

export type Runner = (command: string, args: readonly string[], options?: ExecOptions) => Promise<ExecResult>;

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT = 8 * 1024 * 1024;

/**
 * Ejecuta un binario con un array de argumentos. Nunca usa shell. stdin queda cerrado
 * (/dev/null) para que nada pueda responder a un prompt. Entorno explícito.
 */
export function exec(command: string, args: readonly string[] = [], options: ExecOptions = {}): Promise<ExecResult> {
  const started = Date.now();
  if (!command || command.includes("\0")) return Promise.reject(new Error("Comando inválido"));
  for (const a of args) {
    if (typeof a !== "string" || a.includes("\0")) return Promise.reject(new Error("Argumento inválido"));
  }
  const env = buildEnv(options.env, options.inheritFrom ?? process.env);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;

  return new Promise<ExecResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const child = spawn(command, [...args], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env,
      cwd: options.cwd,
      detached: true,
      windowsHide: true,
    });

    const killGroup = (signal: NodeJS.Signals): void => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          /* ya terminó */
        }
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      setTimeout(() => killGroup("SIGKILL"), 2000).unref();
    }, timeoutMs);

    const collect = (which: "out" | "err") => (chunk: Buffer) => {
      if (bytes >= maxBytes) {
        truncated = true;
        return;
      }
      const room = maxBytes - bytes;
      const piece = chunk.length > room ? chunk.subarray(0, room) : chunk;
      if (piece.length < chunk.length) truncated = true;
      bytes += piece.length;
      if (which === "out") stdout += piece.toString("utf8");
      else stderr += piece.toString("utf8");
    };
    child.stdout.on("data", collect("out"));
    child.stderr.on("data", collect("err"));

    const finish = (r: Omit<ExecResult, "stdout" | "stderr" | "timedOut" | "truncated" | "durationMs">): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...r, stdout, stderr, timedOut, truncated, durationMs: Date.now() - started });
    };

    child.on("error", (err) => finish({ exitCode: null, signal: null, spawnError: err.message }));
    child.on("close", (code, signal) => finish({ exitCode: code, signal }));
  });
}
