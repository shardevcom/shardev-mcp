import type { Tier } from "../core/audit.js";
import type { Environment } from "../core/manifest.js";
import { classifyEnvironment } from "../core/policy.js";

export type { Tier };

export interface OperationDef {
  name: string;
  tier: Tier;
  summary: string;
  /** Si llama al CLI de AWS (afecta a openWorldHint). */
  usesAws: boolean;
}

export interface ToolAnnotationsOut {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: boolean;
  idempotentHint?: boolean;
}

export const REQUIRES_USER_INTERACTION_KEY = "anthropic/requiresUserInteraction";

/**
 * T0 lectura local, T1 lectura AWS, T2 cambio local o no-prod, T3 cambio en producción.
 * `readOnlyHint`/`destructiveHint` van en `annotations`; `requiresUserInteraction` va en `_meta`
 * (ver docs/decisions/0001-spikes.md) y solo para T3.
 */
export function annotationsForTier(tier: Tier, usesAws: boolean): ToolAnnotationsOut {
  switch (tier) {
    case "T0":
      return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
    case "T1":
      return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: usesAws };
    case "T2":
      return { readOnlyHint: false, destructiveHint: false, openWorldHint: usesAws };
    case "T3":
      return { readOnlyHint: false, destructiveHint: true, openWorldHint: true };
  }
}

export function metaForTier(tier: Tier): Record<string, unknown> | undefined {
  return tier === "T3" ? { [REQUIRES_USER_INTERACTION_KEY]: true } : undefined;
}

/** Un cambio T2 sobre un entorno de producción se trata como T3. */
export function effectiveTier(base: Tier, env?: Pick<Environment, "is_production"> & { name?: string }, userProductionEnvs: readonly string[] = []): Tier {
  if (base === "T2" && env && classifyEnvironment({ name: env.name ?? "", is_production: env.is_production }, userProductionEnvs).production) return "T3";
  return base;
}

const registry = new Map<string, OperationDef>();

export function register(def: OperationDef): OperationDef {
  if (registry.has(def.name)) throw new Error(`Operación duplicada: ${def.name}`);
  registry.set(def.name, def);
  return def;
}
export const getOperation = (name: string): OperationDef | undefined => registry.get(name);
export const listOperations = (): OperationDef[] => [...registry.values()];

// Fase 2: solo lectura.
export const OPS_STATUS = register({
  name: "ops_status",
  tier: "T1",
  summary: "Proyectos registrados, perfil, identidad AWS y política efectiva por entorno.",
  usesAws: true,
});
export const LOG_READ = register({
  name: "log_read",
  tier: "T0",
  summary: "Lee o filtra (grep literal) un log guardado por referencia.",
  usesAws: false,
});

// Lectura AWS (ECS/CloudWatch), solo operaciones fijas de lectura; ver docs/decisions/0007-ops-lectura-aws.md.
export const OPS_SERVICES = register({
  name: "ops_services",
  tier: "T1",
  summary: "Estado de los servicios ECS declarados de un entorno (ecs describe-services), con lista blanca de campos.",
  usesAws: true,
});
export const OPS_TASKS = register({
  name: "ops_tasks",
  tier: "T1",
  summary: "Tareas ECS (RUNNING o STOPPED, máx. 20) de un servicio declarado; nunca devuelve overrides ni variables de entorno.",
  usesAws: true,
});
export const OPS_LOGS = register({
  name: "ops_logs",
  tier: "T1",
  summary: "Busca eventos en <log_group_prefix><servicio> (por defecto /ecs/<servicio>; filter-log-events); guarda el contenido redactado y devuelve solo resumen y log_ref.",
  usesAws: true,
});

// Validación local (sin AWS) de los archivos de variables de un entorno; ver docs/decisions/0008-env-check.md.
export const OPS_ENV_CHECK = register({
  name: "ops_env_check",
  tier: "T0",
  summary: "Valida sin conexión los archivos de variables de un entorno (.aws/env/<env>/): disposición, nombres, esquema, aislamiento y consistencia con ops.yaml. Nunca devuelve valores.",
  usesAws: false,
});

// Fase 3: generador (cambian solo el sistema de archivos local; nunca AWS).
export const PROJECT_PLAN = register({
  name: "project_plan",
  tier: "T2",
  summary: "Planifica un proyecto nuevo (archivos, diffs, comandos, conflictos, plan_id). No escribe nada del proyecto.",
  usesAws: false,
});
export const PROJECT_CREATE = register({
  name: "project_create",
  tier: "T2",
  summary: "Crea un proyecto nuevo a partir de un plan_id vigente (destino vacío bajo una raíz permitida; verifica y renombra atómicamente).",
  usesAws: false,
});
export const PROJECT_VERIFY = register({
  name: "project_verify",
  tier: "T2",
  summary: "Re-verifica un proyecto generado y registrado: pasos declarados por las plantillas + escaneo de secretos.",
  usesAws: false,
});

// Fase 5: añadir una app a un proyecto ya generado (solo sistema de archivos local).
export const APP_PLAN = register({
  name: "app_plan",
  tier: "T2",
  summary: "Planifica añadir una app frontend (guards, provider, tabla, modelo, SPA) a un proyecto generado por shardev. No escribe el proyecto.",
  usesAws: false,
});
export const APP_CREATE = register({
  name: "app_create",
  tier: "T2",
  summary: "Aplica un plan_id de app_plan: crea los archivos de la app y los edits por ancla; si algo falla revierte todo.",
  usesAws: false,
});
