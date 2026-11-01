import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { ShardevError } from "../core/errors.js";
import type { Ctx } from "../ops/context.js";
import { buildOutputs, emptyBase, SECRET_MARK_RE, type BuiltOutput, type PlannedFile } from "./build.js";
import { BRANCH_RE, PROTECTED_BRANCHES, git } from "./git.js";
import { PlanStore, assertTargetAllowed, createTargetFree, existingTargetHash, repoReader, repoState, CREATE_TARGET_HASH, type StoredPlan } from "./plan.js";
import { assertNoSymlinks, resolveInside } from "./safe-path.js";
import { templateHash } from "./layers.js";
import { forbiddenFor, loadLeftoverTerms, verifyTree, type VerifyResult } from "./verify.js";

export interface ApplyResult {
  ok: boolean;
  kind: "create" | "existing";
  target: string;
  /** create: el destino quedó intacto si falló. */
  target_untouched?: boolean;
  /** create: directorio temporal conservado (siempre en fallo; nunca existe tras éxito). */
  temp_dir?: string;
  branch?: string;
  base_branch?: string;
  files_written: number;
  verify?: VerifyResult;
  message: string;
}

/** Validaciones comunes de plan: integridad, vigencia, tipo, plantillas y salida reproducible. */
export async function loadAndCheck(ctx: Ctx, planId: string, kind: StoredPlan["kind"]): Promise<StoredPlan> {
  const plan = await new PlanStore(ctx).load(planId);
  if (plan.kind !== kind) throw new ShardevError("invalid_plan", `Este plan es de tipo "${plan.kind}", no "${kind}".`);
  if ((await templateHash(ctx.templatesDir)) !== plan.template_hash) {
    throw new ShardevError("plan_stale", "Las plantillas cambiaron desde que se creó el plan. Genera un plan nuevo.");
  }
  return plan;
}

function checkOutputs(plan: StoredPlan, out: BuiltOutput): void {
  if (out.conflicts.length > 0) throw new ShardevError("plan_stale", `Ahora hay conflictos: ${out.conflicts.slice(0, 3).join("; ")}. Genera un plan nuevo.`);
  if (out.outputs_hash !== plan.outputs_hash) {
    throw new ShardevError("plan_stale", "La salida regenerada no coincide con la del plan (cambió el destino o el plan fue alterado). Genera un plan nuevo.");
  }
}

/** Valor aleatorio de un secreto local (uno por nombre y por proyecto). */
function localSecret(name: string): string {
  if (name === "app_key") return `base64:${randomBytes(32).toString("base64")}`;
  return randomBytes(24).toString("hex");
}

/** Sustituye los marcadores `@@SHARDEV_SECRET:x@@` por valores aleatorios (el mismo valor para el mismo nombre). */
function fillSecrets(content: Buffer, values: Map<string, string>): Buffer {
  return Buffer.from(
    content.toString("utf8").replace(SECRET_MARK_RE, (_m, name: string) => {
      if (!values.has(name)) values.set(name, localSecret(name));
      return values.get(name)!;
    }),
    "utf8",
  );
}

export async function writeFiles(root: string, files: PlannedFile[], created: { files: string[]; dirs: string[] }, hooks: { beforeEdit?: (f: PlannedFile) => void; afterEach?: (f: PlannedFile) => void | Promise<void> } = {}): Promise<void> {
  const secrets = new Map<string, string>();
  for (const f of files) {
    const full = resolveInside(root, f.path);
    await assertNoSymlinks(root, f.path);
    if (f.kind === "create") {
      // directorios intermedios: registra los que creamos para poder revertir
      const parts = dirname(f.path).split("/").filter((p) => p !== ".");
      let cur = root;
      for (const p of parts) {
        cur = join(cur, p);
        const made = await mkdir(cur).then(() => true, (e: NodeJS.ErrnoException) => {
          if (e.code === "EEXIST") return false;
          throw e;
        });
        if (made) created.dirs.push(cur);
      }
      await writeFile(full, f.secret ? fillSecrets(f.content, secrets) : f.content, { flag: "wx", mode: f.mode });
      await chmod(full, f.mode);
      created.files.push(full);
    } else {
      // Un edit solo se aplica sobre el contenido que se planeó: si cambió justo ahora, no se pisa.
      if (f.before) {
        const current = await readFile(full).catch(() => null);
        if (current === null || !current.equals(f.before)) throw new ShardevError("plan_stale", `${f.path} cambió mientras se aplicaba; no se sobrescribe`);
      }
      hooks.beforeEdit?.(f);
      await writeFile(full, f.content);
    }
    if (hooks.afterEach) await hooks.afterEach(f);
  }
}

/** project_create: proyecto nuevo. Genera en un temporal junto al destino, verifica y renombra atómicamente. */
export async function applyCreate(ctx: Ctx, planId: string): Promise<ApplyResult> {
  const plan = await loadAndCheck(ctx, planId, "create");
  const target = await assertTargetAllowed(ctx, plan.target);
  if (target !== plan.target) throw new ShardevError("plan_stale", "El destino resuelve a otra ruta que en el plan.");
  const busy = await createTargetFree(target);
  if (busy) throw new ShardevError("target_not_free", `${busy}. project_create solo crea proyectos nuevos en un destino ausente o vacío.`);
  if (CREATE_TARGET_HASH !== plan.target_hash) throw new ShardevError("plan_stale", "El hash del destino cambió.");
  const out = await buildOutputs(plan.spec, ctx.templatesDir, emptyBase);
  checkOutputs(plan, out);

  const parent = dirname(target);
  const tmp = join(parent, `.${basename(target)}.shardev-tmp-${randomBytes(4).toString("hex")}`);
  const fail = (message: string, verify?: VerifyResult, files = 0): ApplyResult => ({
    ok: false,
    kind: "create",
    target,
    target_untouched: true,
    temp_dir: tmp,
    files_written: files,
    ...(verify ? { verify } : {}),
    message: `${message} El destino no se tocó; el temporal quedó en ${tmp} para inspección.`,
  });
  try {
    await mkdir(tmp, { mode: 0o755 });
  } catch (e) {
    throw new ShardevError("apply_failed", `No se pudo crear el directorio temporal junto al destino (¿existe ${parent}?): ${(e as Error).message}`);
  }
  let written = 0;
  try {
    await writeFiles(tmp, out.files, { files: [], dirs: [] });
    written = out.files.length;
  } catch (e) {
    return fail(`Falló la escritura: ${e instanceof Error ? e.message : String(e)}.`, undefined, written);
  }
  const verify = await verifyTree(ctx, tmp, out.steps.filter((s) => !s.full), out.files.filter((f) => !f.secret).map((f) => f.path), forbiddenFor(plan.spec, await loadLeftoverTerms(ctx)));
  if (!verify.ok) return fail(`La verificación falló: ${verify.summary}.`, verify, written);

  // Re-chequeo justo antes del rename (otro proceso pudo ocupar el destino).
  const busy2 = await createTargetFree(target);
  if (busy2) return fail(`El destino dejó de estar libre (${busy2}).`, verify, written);
  try {
    await rename(tmp, target);
  } catch (e) {
    return fail(`No se pudo renombrar al destino: ${(e as Error).message}.`, verify, written);
  }
  await new PlanStore(ctx).delete(plan.id);
  return { ok: true, kind: "create", target, files_written: written, verify, message: `Proyecto creado en ${target}. ${verify.summary}.` };
}

/**
 * Aplica un plan sobre un repo existente (lo usará app_create). Exige árbol limpio, hash de destino
 * sin cambios y plan íntegro/vigente. Crea una rama nueva derivada del plan y escribe SOLO ahí.
 * No hace push, no commitea, no corre migraciones. Si algo falla, revierte y borra la rama creada.
 */
export async function applyExisting(ctx: Ctx, planId: string): Promise<ApplyResult> {
  const plan = await loadAndCheck(ctx, planId, "existing");
  const repo = await assertTargetAllowed(ctx, plan.target);
  if (repo !== plan.target) throw new ShardevError("plan_stale", "El repositorio resuelve a otra ruta que en el plan.");
  const branch = plan.branch;
  if (!branch || !BRANCH_RE.test(branch.name) || PROTECTED_BRANCHES.test(branch.name)) throw new ShardevError("invalid_plan", "El plan no trae una rama de trabajo válida.");

  const state = await repoState(ctx, repo);
  if (state.problems.length > 0) throw new ShardevError("repo_not_clean", `No se aplica: ${state.problems.join("; ")}.`);
  const out = await buildOutputs(plan.spec, ctx.templatesDir, repoReader(repo));
  if (existingTargetHash(state, out) !== plan.target_hash) {
    throw new ShardevError("plan_stale", "El estado del repositorio cambió desde el plan (HEAD, rama o archivos afectados). Genera un plan nuevo.");
  }
  checkOutputs(plan, out);
  if (state.branch !== branch.base) throw new ShardevError("plan_stale", `La rama actual (${state.branch}) no es la base del plan (${branch.base}).`);
  const exists = await git(ctx, repo, ["rev-parse", "--verify", "-q", `refs/heads/${branch.name}`], { allowFail: true });
  if (exists.ok) throw new ShardevError("apply_failed", `La rama ${branch.name} ya existe.`);

  await git(ctx, repo, ["switch", "-c", branch.name]);
  const created = { files: [] as string[], dirs: [] as string[] };
  const rollback = async (): Promise<void> => {
    for (const f of out.files) {
      if (f.kind === "edit" && f.before) await writeFile(resolveInside(repo, f.path), f.before).catch(() => undefined);
    }
    for (const p of created.files) await rm(p, { force: true }).catch(() => undefined);
    for (const d of created.dirs.reverse()) await rmdir(d).catch(() => undefined);
    await git(ctx, repo, ["switch", branch.base], { allowFail: true });
    await git(ctx, repo, ["branch", "-D", branch.name], { allowFail: true });
  };
  const bail = async (message: string, verify?: VerifyResult): Promise<ApplyResult> => {
    await rollback();
    return { ok: false, kind: "existing", target: repo, branch: branch.name, base_branch: branch.base, files_written: 0, ...(verify ? { verify } : {}), message: `${message} Se revirtió: rama ${branch.name} eliminada y ${branch.base} intacta.` };
  };
  try {
    const cur = await git(ctx, repo, ["symbolic-ref", "--short", "-q", "HEAD"]);
    if (cur.out !== branch.name) return await bail("HEAD no quedó en la rama nueva; no se escribió nada.");
    await writeFiles(repo, out.files, created);
  } catch (e) {
    return await bail(`Falló la escritura: ${e instanceof Error ? e.message : String(e)}.`);
  }
  const verify = await verifyTree(ctx, repo, out.steps.filter((s) => !s.full), out.files.filter((f) => !f.secret).map((f) => f.path), forbiddenFor(plan.spec, await loadLeftoverTerms(ctx)));
  if (!verify.ok) return await bail(`La verificación falló: ${verify.summary}.`, verify);

  await new PlanStore(ctx).delete(plan.id);
  return {
    ok: true,
    kind: "existing",
    target: repo,
    branch: branch.name,
    base_branch: branch.base,
    files_written: out.files.length,
    verify,
    message: `Cambios aplicados en la rama nueva ${branch.name} (sin commit, sin push, sin migraciones). ${verify.summary}.`,
  };
}

