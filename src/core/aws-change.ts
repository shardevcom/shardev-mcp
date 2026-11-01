import { loginCommandFor, NO_SESSION_RE } from "./aws-identity.js";
import { exec, type Runner } from "./exec.js";
import type { Redactor } from "./redact.js";
import type { AwsTarget } from "./aws-read.js";

/**
 * Lista cerrada de operaciones del CLI de AWS que CAMBIAN algo y que este paquete puede lanzar.
 * Solo la usa la CLI (nunca el servidor MCP: hay un test que lo comprueba sobre el grafo de imports).
 * Cualquier otra se rechaza antes de llamar al runner.
 */
export const ALLOWED_AWS_CHANGES = ["ecs update-service"] as const;
export type AwsChange = (typeof ALLOWED_AWS_CHANGES)[number];

export type AwsChangeResult =
  | { state: "ok"; json: unknown }
  | { state: "no-session"; message: string; loginCommand: string }
  /** Se agotó el tiempo: el cambio PUDO aplicarse. No se sabe. */
  | { state: "timeout"; message: string }
  | { state: "error"; message: string };

/** Ejecuta UNA operación de cambio permitida como array de argumentos (nunca shell). Nunca devuelve la salida cruda: solo JSON parseado para que el llamador filtre campos. */
export async function awsChange(
  operation: AwsChange,
  params: readonly string[],
  target: AwsTarget,
  options: { runner?: Runner; redactor?: Redactor; timeoutMs?: number } = {},
): Promise<AwsChangeResult> {
  if (!(ALLOWED_AWS_CHANGES as readonly string[]).includes(operation)) {
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

  if (r.spawnError) return { state: "error", message: `No se pudo ejecutar el CLI de AWS (${clean(r.spawnError)}). No se cambió nada.` };
  if (r.timedOut) return { state: "timeout", message: `${label} excedió el tiempo de espera.` };
  if (r.exitCode !== 0) {
    if (NO_SESSION_RE.test(r.stderr)) {
      const loginCommand = loginCommandFor(target.profile);
      return { state: "no-session", loginCommand, message: `No hay sesión válida para el perfil "${target.profile}". Inicia sesión tú con: ${loginCommand}` };
    }
    return { state: "error", message: `${label} falló (exit ${r.exitCode}): ${clean(r.stderr)}` };
  }
  try {
    return { state: "ok", json: r.stdout.trim() === "" ? {} : JSON.parse(r.stdout) };
  } catch {
    return { state: "ok", json: {} }; // exit 0: se aplicó; la respuesta no se pudo leer
  }
}
