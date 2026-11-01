import { readFile, stat } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";
import { ShardevError } from "./errors.js";
import { MODES, ModeSchema, type Environment, type Mode, type OpsManifest } from "./manifest.js";
import { policyFile, type Paths } from "./paths.js";
import type { IdentityResult } from "./aws-identity.js";

export const PolicySchema = z
  .object({
    default_mode: ModeSchema.default("command-only"),
    aws_profiles: z
      .record(
        z.string().min(1),
        z
          .object({
            account_id: z.string().regex(/^\d{12}$/),
            production_mode: ModeSchema,
            /** Si se indica, el perfil solo opera sobre estos entornos; fuera de la lista = disabled. */
            environments: z.array(z.string().min(1)).optional(),
          })
          .strict(),
      )
      .default({}),
  })
  .strict();
export type Policy = z.infer<typeof PolicySchema>;

export const DEFAULT_POLICY: Policy = { default_mode: "command-only", aws_profiles: {} };

export const modeRank = (m: Mode): number => MODES.indexOf(m);
export const mostRestrictive = (...modes: Mode[]): Mode =>
  modes.reduce((a, b) => (modeRank(b) < modeRank(a) ? b : a));

export interface LoadedPolicy {
  policy: Policy;
  /** Avisos no fatales (p. ej. permisos del archivo). */
  warnings: string[];
}

/**
 * Carga policy.yaml del usuario. Archivo ausente = `command-only` por defecto.
 * Archivo inválido = error (el llamador debe tratarlo como `disabled`).
 */
export async function loadPolicy(paths: Paths): Promise<LoadedPolicy> {
  const file = policyFile(paths);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { policy: DEFAULT_POLICY, warnings: [] };
    throw e;
  }
  const warnings: string[] = [];
  try {
    const st = await stat(file);
    if ((st.mode & 0o022) !== 0) warnings.push(`policy.yaml es escribible por grupo/otros (modo ${(st.mode & 0o777).toString(8)}); usa chmod 600.`);
  } catch {
    /* sin aviso */
  }
  let raw: unknown;
  try {
    raw = parse(text) ?? {};
  } catch (e) {
    throw new ShardevError("invalid_policy", `policy.yaml no es YAML válido: ${(e as Error).message.split("\n")[0]}`);
  }
  const r = PolicySchema.safeParse(raw);
  if (!r.success) {
    throw new ShardevError("invalid_policy", `policy.yaml inválido: ${r.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ")}`);
  }
  return { policy: r.data, warnings };
}

export type PolicyDecision =
  | {
      status: "allowed";
      /** Modo pedido por las reglas (puede ser gated-apply). */
      requestedMode: Mode;
      /** Modo con el que realmente se actúa en esta versión. */
      effectiveMode: "command-only";
      notes: string[];
      identity: Extract<IdentityResult, { state: "ok" }>;
    }
  | { status: "disabled"; reason: string }
  | { status: "unavailable"; message: string; loginCommand?: string }
  | { status: "rejected"; reason: string };

export interface ModeResolution {
  mode: Mode;
  reason: string;
  /** Presente si las fuentes discrepaban sobre si el entorno es producción (gana producción). */
  productionConflict?: string;
}

const PROD_NAME_RE = /^prod(uction)?$/i;

export interface EnvClassification {
  production: boolean;
  /** Qué fuentes lo marcan como producción. */
  sources: Array<"manifest" | "name" | "user-config">;
  conflict?: string;
}

/**
 * Un entorno es producción si CUALQUIERA lo dice: el manifest, su nombre (/^prod(uction)?$/i)
 * o la lista `production_envs` del proyecto en projects.yaml (config del dueño). El manifest
 * lo puede editar un agente, así que `is_production: false` nunca basta. El account_id no
 * discrimina (staging y producción comparten cuenta).
 */
export function classifyEnvironment(env: Pick<Environment, "name" | "is_production">, userProductionEnvs: readonly string[] = []): EnvClassification {
  const sources: EnvClassification["sources"] = [];
  if (env.is_production) sources.push("manifest");
  if (PROD_NAME_RE.test(env.name)) sources.push("name");
  if (userProductionEnvs.includes(env.name)) sources.push("user-config");
  const production = sources.length > 0;
  const conflict =
    production && !env.is_production
      ? `ops.yaml declara is_production: false para "${env.name}", pero ${sources.map((x) => (x === "name" ? "su nombre" : "projects.yaml (production_envs)")).join(" y ")} lo marca como producción: se trata como PRODUCCIÓN.`
      : undefined;
  return { production, sources, ...(conflict ? { conflict } : {}) };
}

/**
 * Parte pura (sin AWS): el modo más restrictivo entre la regla del usuario y el tope del proyecto.
 * - No producción: `default_mode` del usuario.
 * - Producción: regla del perfil; perfil desconocido => disabled (fail closed).
 * El `max_mode` de ops.yaml solo puede bajar el modo, nunca subirlo.
 */
export function resolveMode(
  policy: Policy,
  manifest: OpsManifest,
  env: Environment,
  userProductionEnvs: readonly string[] = [],
): ModeResolution {
  const cls = classifyEnvironment(env, userProductionEnvs);
  let user: Mode;
  let reason: string;
  const rule = Object.hasOwn(policy.aws_profiles, env.aws_profile) ? policy.aws_profiles[env.aws_profile] : undefined;

  if (rule?.environments && !rule.environments.includes(env.name)) {
    return { mode: "disabled", reason: `El perfil ${env.aws_profile} no tiene permitido el entorno ${env.name} en policy.yaml.` };
  }
  if (cls.production) {
    if (!rule) {
      return {
        mode: "disabled",
        reason: `Perfil "${env.aws_profile}" desconocido para producción: no está en policy.yaml (aws_profiles). Se bloquea por seguridad.${cls.conflict ? " " + cls.conflict : ""}`,
        ...(cls.conflict ? { productionConflict: cls.conflict } : {}),
      };
    }
    user = rule.production_mode;
    reason = `policy.yaml: aws_profiles.${env.aws_profile}.production_mode = ${user}`;
    if (cls.conflict) reason += `; ${cls.conflict}`;
  } else {
    user = policy.default_mode;
    reason = `policy.yaml: default_mode = ${user}`;
  }
  const cap = manifest.policy?.max_mode;
  const mode = cap ? mostRestrictive(user, cap) : user;
  if (cap && modeRank(cap) < modeRank(user)) reason += `; ops.yaml limita a ${cap}`;
  else if (cap && modeRank(cap) > modeRank(user)) reason += `; ops.yaml (${cap}) no puede ampliar la policy del usuario`;
  return { mode, reason, ...(cls.conflict ? { productionConflict: cls.conflict } : {}) };
}

export type IdentityProvider = () => Promise<IdentityResult>;

/**
 * Decisión completa. Solo consulta la identidad AWS si el modo no es `disabled`.
 * Sin sesión => unavailable (con el comando de login exacto; no se intenta iniciar sesión).
 * Cuenta distinta a la del manifest (o a la del perfil en policy) => rejected.
 */
export async function decide(
  policy: Policy,
  manifest: OpsManifest,
  env: Environment,
  getIdentity: IdentityProvider,
  userProductionEnvs: readonly string[] = [],
): Promise<PolicyDecision> {
  const { mode, reason } = resolveMode(policy, manifest, env, userProductionEnvs);
  if (mode === "disabled") return { status: "disabled", reason };

  const identity = await getIdentity();
  if (identity.state === "no-session") {
    return { status: "unavailable", message: identity.message, loginCommand: identity.loginCommand };
  }
  if (identity.state === "error") return { status: "unavailable", message: identity.message };

  if (identity.account !== env.account_id) {
    return {
      status: "rejected",
      reason: `La cuenta autenticada (${identity.account}) no coincide con la de ops.yaml para ${env.name} (${env.account_id}).`,
    };
  }
  const rule = Object.hasOwn(policy.aws_profiles, env.aws_profile) ? policy.aws_profiles[env.aws_profile] : undefined;
  if (rule && rule.account_id !== identity.account) {
    return {
      status: "rejected",
      reason: `La cuenta autenticada (${identity.account}) no coincide con la declarada para el perfil ${env.aws_profile} en policy.yaml (${rule.account_id}).`,
    };
  }

  const notes = [reason];
  if (mode === "gated-apply") {
    notes.push("gated-apply NO está implementado en esta versión: se comporta como command-only (se devuelve el comando; nada se ejecuta).");
  }
  return { status: "allowed", requestedMode: mode, effectiveMode: "command-only", notes, identity };
}

const SAFE_ARG = /^[A-Za-z0-9_@%+=:,./-]+$/;
const shellQuote = (a: string): string => (SAFE_ARG.test(a) ? a : `'${a.replaceAll("'", `'\\''`)}'`);

/** Comando exacto (con comillas de shell) para que lo ejecute el humano. */
export function renderCommand(argv: readonly string[]): string {
  return argv.map(shellQuote).join(" ");
}

/** Resultado de `command-only`: se devuelve el comando y NO se ejecuta nada. */
export function commandOnlyResponse(decision: Extract<PolicyDecision, { status: "allowed" }>, argv: readonly string[]): string {
  const lines = [
    "Modo command-only: no se ejecutó nada. Ejecuta tú este comando:",
    renderCommand(argv),
    ...decision.notes.map((n) => `- ${n}`),
  ];
  return lines.join("\n");
}
