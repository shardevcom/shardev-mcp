import { ShardevError } from "../core/errors.js";
import {
  assertServiceName,
  declaredServices,
  requireCapability,
  requireEnvironment,
  resolveProject,
  type Environment,
  type ResolvedProject,
} from "../core/manifest.js";
import type { PolicyDecision } from "../core/policy.js";
import type { Ctx, ToolOutcome } from "./context.js";
import { evaluatePolicy } from "./read-gate.js";

export interface ChangeArgs {
  project?: unknown;
  env?: unknown;
  service?: unknown;
  all?: unknown;
}

export type ChangeGate =
  | { ok: true; project: ResolvedProject; env: Environment; services: string[]; all: boolean; decision: Extract<PolicyDecision, { status: "allowed" }> }
  | { ok: false; outcome: ToolOutcome };

/**
 * Preámbulo común de las operaciones que CAMBIAN algo (T3). Mismo orden que `gateRead`: validación local
 * (proyecto, env obligatorio, capacidad, objetivo) -> política -> identidad. A diferencia de las lecturas
 * conserva la decisión de política para que la herramienta devuelva `commandOnlyResponse` con sus notas.
 * Objetivo: exactamente uno de `service` (declarado) o `all: true` (todos los declarados); sin valor por
 * defecto. Nunca llama a una API de AWS que modifique: la única llamada es la de identidad.
 */
export async function gateChange(ctx: Ctx, args: ChangeArgs, capability: "ecs" | "logs"): Promise<ChangeGate> {
  const project = typeof args.project === "string" ? args.project : undefined;
  const envName = typeof args.env === "string" ? args.env : undefined;
  const fail = (text: string, decision: ToolOutcome["decision"]): ChangeGate => ({
    ok: false,
    outcome: { text, isError: true, decision, ...(project ? { project } : {}), ...(envName ? { env: envName } : {}) },
  });

  let resolved: ResolvedProject;
  let env: Environment;
  let services: string[];
  let all = false;
  try {
    if (project === undefined || project === "") throw new ShardevError("invalid_input", "Debes indicar `project` (nombre de un proyecto registrado).");
    resolved = await resolveProject(ctx.paths, project);
    env = requireEnvironment(resolved.manifest, envName);
    requireCapability(resolved.manifest, capability);
    const hasService = args.service !== undefined;
    const hasAll = args.all !== undefined;
    if (hasService === hasAll) throw new ShardevError("invalid_input", "Indica exactamente uno: `service` (un servicio declarado) o `all: true` (todos los declarados). No hay objetivo por defecto.");
    if (hasAll) {
      if (args.all !== true) throw new ShardevError("invalid_input", "`all` solo admite `true`.");
      all = true;
      services = declaredServices(resolved.manifest, env);
    } else {
      if (typeof args.service !== "string") throw new ShardevError("foreign_service", "`service` debe ser un texto.");
      assertServiceName(resolved.manifest, env, args.service);
      services = [args.service];
    }
  } catch (e) {
    if (e instanceof ShardevError) return fail(e.message, "rejected");
    throw e;
  }

  const pg = await evaluatePolicy(ctx, resolved, env);
  if (!pg.ok) return fail(pg.text, pg.decision);
  return { ok: true, project: resolved, env, services, all, decision: pg.decision };
}
