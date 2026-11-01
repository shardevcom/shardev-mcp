import { loginCommandFor, NO_SESSION_RE } from "./aws-identity.js";
import { exec, type Runner } from "./exec.js";
import type { Redactor } from "./redact.js";

/**
 * Lista cerrada de operaciones de lectura del CLI de AWS que este servidor puede lanzar (además de
 * `sts get-caller-identity`, que vive en aws-identity.ts). Cualquier otra se rechaza antes de llamar al runner.
 */
export const ALLOWED_AWS_READS = [
  "ecs describe-services",
  "ecs list-tasks",
  "ecs describe-tasks",
  "logs filter-log-events",
] as const;
export type AwsRead = (typeof ALLOWED_AWS_READS)[number];

export interface AwsTarget {
  profile: string;
  region: string;
}

export type AwsReadResult =
  | { state: "ok"; json: unknown }
  | { state: "no-session"; message: string; loginCommand: string }
  | { state: "error"; message: string };

/**
 * Ejecuta UNA operación de lectura permitida como array de argumentos (nunca shell). `params` son pares
 * flag/valor ya construidos por el llamador a partir de datos validados; el subcomando no es parametrizable.
 */
export async function awsRead(
  operation: AwsRead,
  params: readonly string[],
  target: AwsTarget,
  options: { runner?: Runner; redactor?: Redactor; timeoutMs?: number } = {},
): Promise<AwsReadResult> {
  if (!(ALLOWED_AWS_READS as readonly string[]).includes(operation)) {
    return { state: "error", message: `Operación AWS no permitida: ${String(operation).slice(0, 40)}` };
  }
  const runner = options.runner ?? exec;
  const clean = (s: string): string => {
    const t = (options.redactor ? options.redactor.redact(s) : s).trim().split("\n").slice(-3).join(" ");
    return t.slice(0, 300);
  };
  const [service, op] = operation.split(" ") as [string, string];
  const argv = [service, op, ...params, "--profile", target.profile, "--region", target.region, "--output", "json", "--no-cli-pager"];
  const label = `aws ${operation}`;
  const r = await runner("aws", argv, { timeoutMs: options.timeoutMs ?? 60_000 });

  if (r.spawnError) return { state: "error", message: `No se pudo ejecutar el CLI de AWS (${clean(r.spawnError)}). ¿Está instalado y en PATH?` };
  if (r.timedOut) return { state: "error", message: `${label} excedió el tiempo de espera.` };
  if (r.exitCode !== 0) {
    if (NO_SESSION_RE.test(r.stderr)) {
      const loginCommand = loginCommandFor(target.profile);
      return {
        state: "no-session",
        loginCommand,
        message: `Operaciones AWS no disponibles: no hay sesión válida para el perfil "${target.profile}". Inicia sesión tú con: ${loginCommand}`,
      };
    }
    return { state: "error", message: `${label} falló (exit ${r.exitCode}): ${clean(r.stderr)}` };
  }
  if (r.truncated) return { state: "error", message: `${label}: la salida superó el límite; reduce el alcance (limit / since_minutes).` };
  try {
    return { state: "ok", json: r.stdout.trim() === "" ? {} : JSON.parse(r.stdout) };
  } catch {
    return { state: "error", message: `Respuesta inesperada de ${label}.` };
  }
}
