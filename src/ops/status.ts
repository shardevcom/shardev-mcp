import { getIdentity, type IdentityResult } from "../core/aws-identity.js";
import { ShardevError } from "../core/errors.js";
import { loadRegistry, requireEnvironment, resolveProject, type Environment, type OpsManifest } from "../core/manifest.js";
import { classifyEnvironment, decide, loadPolicy, type Policy, type PolicyDecision } from "../core/policy.js";
import type { Ctx, ToolOutcome } from "./context.js";

export interface OpsStatusArgs {
  project?: string;
  env?: string;
}

const DISABLED_POLICY_ERROR = "policy.yaml es inválido: todo queda disabled hasta corregirlo.";

function describeDecision(d: PolicyDecision): Record<string, unknown> {
  switch (d.status) {
    case "allowed":
      return {
        status: "allowed",
        requested_mode: d.requestedMode,
        effective_mode: d.effectiveMode,
        notes: d.notes,
        identity: { account: d.identity.account, arn: d.identity.arn },
      };
    case "disabled":
      return { status: "disabled", reason: d.reason };
    case "unavailable":
      return { status: "unavailable", message: d.message, ...(d.loginCommand ? { login_command: d.loginCommand } : {}) };
    case "rejected":
      return { status: "rejected", reason: d.reason };
  }
}

/** Solo lectura: lista proyectos y, con `project`, la política efectiva por entorno. */
export async function opsStatus(ctx: Ctx, args: OpsStatusArgs): Promise<ToolOutcome> {
  let policy: Policy | null = null;
  let policyError: string | undefined;
  let warnings: string[] = [];
  try {
    const loaded = await loadPolicy(ctx.paths);
    policy = loaded.policy;
    warnings = loaded.warnings;
  } catch (e) {
    policyError = e instanceof ShardevError ? e.message : "No se pudo leer policy.yaml.";
  }

  try {
    if (args.project === undefined) {
      const registry = await loadRegistry(ctx.paths);
      const projects = [];
      for (const name of Object.keys(registry.projects)) {
        try {
          const p = await resolveProject(ctx.paths, name);
          projects.push({
            name,
            path: p.path,
            stack: p.manifest.stack,
            environments: p.manifest.environments.map((e) => ({ name: e.name, is_production: classifyEnvironment(e, p.productionEnvs).production })),
          });
        } catch (e) {
          projects.push({ name, error: e instanceof ShardevError ? e.message : "error al leer ops.yaml" });
        }
      }
      return {
        text: JSON.stringify({ policy_error: policyError ?? null, warnings, projects }, null, 2),
        isError: false,
        decision: "allowed",
      };
    }

    const project = await resolveProject(ctx.paths, args.project);
    const envs: Environment[] = args.env === undefined ? project.manifest.environments : [requireEnvironment(project.manifest, args.env)];

    const identityCache = new Map<string, Promise<IdentityResult>>();
    const identityFor = (e: Environment): Promise<IdentityResult> => {
      const key = `${e.aws_profile}|${e.region}`;
      let p = identityCache.get(key);
      if (!p) {
        p = getIdentity(e.aws_profile, e.region, { runner: ctx.runner, redactor: ctx.redactor });
        identityCache.set(key, p);
      }
      return p;
    };

    const rows = [];
    for (const e of envs) {
      let decision: Record<string, unknown>;
      if (policy === null) decision = { status: "disabled", reason: DISABLED_POLICY_ERROR };
      else decision = describeDecision(await decide(policy, project.manifest as OpsManifest, e, () => identityFor(e), project.productionEnvs));
      rows.push({
        env: e.name,
        is_production: classifyEnvironment(e, project.productionEnvs).production,
        ...(classifyEnvironment(e, project.productionEnvs).conflict ? { production_conflict: classifyEnvironment(e, project.productionEnvs).conflict } : {}),
        aws_profile: e.aws_profile,
        account_id: e.account_id,
        region: e.region,
        cluster: e.cluster,
        policy: decision,
      });
    }
    return {
      text: JSON.stringify({ project: project.name, service_prefix: project.manifest.service_prefix, policy_error: policyError ?? null, warnings, environments: rows }, null, 2),
      isError: false,
      decision: "allowed",
      project: project.name,
      env: args.env,
    };
  } catch (e) {
    if (e instanceof ShardevError) {
      return { text: e.message, isError: true, decision: "rejected", project: args.project, env: args.env };
    }
    throw e;
  }
}
