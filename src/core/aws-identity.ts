import { exec, type Runner } from "./exec.js";
import type { Redactor } from "./redact.js";

export type IdentityResult =
  | { state: "ok"; profile: string; account: string; arn: string }
  | { state: "no-session"; profile: string; loginCommand: string; message: string }
  | { state: "error"; profile: string; message: string };

export const loginCommandFor = (profile: string): string => `aws sso login --profile ${profile}`;

export const NO_SESSION_RE =
  /(token has expired|expired|sso session|sso token|unable to locate credentials|no credentials|refresh failed|error loading sso|login|invalid(?:client)?token|security token.*invalid)/i;
const PROFILE_MISSING_RE = /profile .*could not be found/i;

/**
 * `aws sts get-caller-identity` (solo lectura) a través de exec. No intenta iniciar sesión nunca.
 * El runner es inyectable para que los tests no toquen AWS.
 */
export async function getIdentity(
  profile: string,
  region: string,
  options: { runner?: Runner; redactor?: Redactor; timeoutMs?: number } = {},
): Promise<IdentityResult> {
  const runner = options.runner ?? exec;
  const clean = (s: string): string => {
    const t = (options.redactor ? options.redactor.redact(s) : s).trim().split("\n").slice(-3).join(" ");
    return t.slice(0, 300);
  };
  const r = await runner(
    "aws",
    ["sts", "get-caller-identity", "--profile", profile, "--region", region, "--output", "json", "--no-cli-pager"],
    { timeoutMs: options.timeoutMs ?? 20_000 },
  );

  if (r.spawnError) {
    return { state: "error", profile, message: `No se pudo ejecutar el CLI de AWS (${clean(r.spawnError)}). ¿Está instalado y en PATH?` };
  }
  if (r.timedOut) return { state: "error", profile, message: "aws sts get-caller-identity excedió el tiempo de espera." };

  if (r.exitCode === 0) {
    try {
      const j = JSON.parse(r.stdout) as { Account?: unknown; Arn?: unknown };
      if (typeof j.Account === "string" && typeof j.Arn === "string") {
        return { state: "ok", profile, account: j.Account, arn: j.Arn };
      }
    } catch {
      /* cae al error */
    }
    return { state: "error", profile, message: "Respuesta inesperada de aws sts get-caller-identity." };
  }

  const err = r.stderr;
  if (PROFILE_MISSING_RE.test(err)) {
    return { state: "error", profile, message: `El perfil de AWS "${profile}" no existe en la configuración local.` };
  }
  if (NO_SESSION_RE.test(err)) {
    const loginCommand = loginCommandFor(profile);
    return {
      state: "no-session",
      profile,
      loginCommand,
      message: `Operaciones AWS no disponibles: no hay sesión válida para el perfil "${profile}". Inicia sesión tú con: ${loginCommand}`,
    };
  }
  return { state: "error", profile, message: `aws sts get-caller-identity falló (exit ${r.exitCode}): ${clean(err)}` };
}
