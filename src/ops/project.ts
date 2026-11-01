import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { ShardevError } from "../core/errors.js";
import { loadRegistry } from "../core/manifest.js";
import { applyCreate } from "../gen/apply.js";
import { LOCK_PATH, collectSteps } from "../gen/build.js";
import { loadLayers, templateHash } from "../gen/layers.js";
import { planCreate } from "../gen/plan.js";
import { safeRel } from "../gen/safe-path.js";
import { resolveProjectSpec } from "../gen/spec.js";
import { forbiddenFor, loadLeftoverTerms, verifyTree } from "../gen/verify.js";
import type { Ctx, ToolOutcome } from "./context.js";

const rejected = (e: ShardevError, extra: Partial<ToolOutcome> = {}): ToolOutcome => ({ text: e.message, isError: true, decision: "rejected", ...extra });

export async function projectPlan(ctx: Ctx, args: { spec: unknown; target: string }): Promise<ToolOutcome> {
  try {
    const plan = await planCreate(ctx, args.spec, args.target);
    const note = plan.plan_id
      ? "Plan válido. Nada se creó todavía: aplica con project_create(plan_id) (vigente 30 min)."
      : "El plan tiene conflictos y NO se guardó (sin plan_id): corrígelos y vuelve a planear.";
    return { text: JSON.stringify({ note, ...plan }, null, 2), isError: false, decision: "allowed" };
  } catch (e) {
    if (e instanceof ShardevError) return rejected(e);
    throw e;
  }
}

export async function projectCreate(ctx: Ctx, args: { plan_id: string }): Promise<ToolOutcome> {
  try {
    const r = await applyCreate(ctx, args.plan_id);
    return { text: JSON.stringify(r, null, 2), isError: !r.ok, decision: r.ok ? "allowed" : "error" };
  } catch (e) {
    if (e instanceof ShardevError) return rejected(e);
    throw e;
  }
}

const LockSchema = z.object({ version: z.literal(1), template_hash: z.string(), layers: z.array(z.string()), spec: z.unknown(), files: z.array(z.object({ path: z.string(), sha256: z.string() })) }).passthrough();

/** Re-verifica un proyecto generado y registrado. Los pasos salen de las PLANTILLAS, nunca del lock. */
export async function projectVerify(ctx: Ctx, args: { project: string }): Promise<ToolOutcome> {
  try {
    const registry = await loadRegistry(ctx.paths);
    const entry = Object.hasOwn(registry.projects, args.project) ? registry.projects[args.project] : undefined;
    if (!entry) throw new ShardevError("unregistered_project", `El proyecto "${args.project}" no está registrado en projects.yaml.`);
    const lockFull = join(entry.path, LOCK_PATH);
    const st = await lstat(lockFull).catch(() => null);
    if (!st || !st.isFile()) throw new ShardevError("invalid_plan", `No se encontró ${LOCK_PATH} en el proyecto (¿se generó con project_create?).`);
    const lock = LockSchema.safeParse(parse(await readFile(lockFull, "utf8")));
    if (!lock.success) throw new ShardevError("invalid_plan", `${LOCK_PATH} inválido.`);
    const spec = resolveProjectSpec(lock.data.spec);
    const layers = (await loadLayers(ctx.templatesDir)).filter((l) => lock.data.layers.includes(l.name));
    const steps = collectSteps(layers, spec);
    const scan = [...new Set([LOCK_PATH, ...lock.data.files.map((f) => safeRel(f.path, "lock.files"))])];
    const drift = (await templateHash(ctx.templatesDir)) !== lock.data.template_hash;
    const r = await verifyTree(ctx, entry.path, steps, scan, forbiddenFor(spec, await loadLeftoverTerms(ctx)));
    const text = JSON.stringify({ project: args.project, ...r, ...(drift ? { note: "Las plantillas cambiaron desde la generación; los pasos son los de las plantillas actuales." } : {}) }, null, 2);
    return { text, isError: !r.ok, decision: r.ok ? "allowed" : "error", project: args.project };
  } catch (e) {
    if (e instanceof ShardevError) return rejected(e, { project: args.project });
    throw e;
  }
}
