import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lstat, readdir, readFile, realpath, writeFile, chmod, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { loadConfig } from "../core/config.js";
import { ShardevError } from "../core/errors.js";
import { ensurePrivateDir } from "../core/fsutil.js";
import { planKeyFile, plansDir } from "../core/paths.js";
import { renderCommand } from "../core/policy.js";
import type { Ctx } from "../ops/context.js";
import { buildOutputs, emptyBase, stableStringify, type BaseReader, type BuiltOutput } from "./build.js";
import { BRANCH_RE, PROTECTED_BRANCHES, git } from "./git.js";
import { assertNoSymlinks, resolveInside } from "./safe-path.js";
import { resolveProjectSpec, type ProjectSpec } from "./spec.js";

export const PLAN_TTL_MS = 30 * 60 * 1000;
const PLAN_ID_RE = /^plan_[0-9a-f]{32}$/;
const sha = (s: string | Buffer): string => createHash("sha256").update(s).digest("hex");

export interface StoredPlan {
  v: 1;
  id: string;
  kind: "create" | "existing" | "app";
  created_at: string;
  expires_at: string;
  spec: ProjectSpec;
  template_hash: string;
  target: string;
  target_hash: string;
  outputs_hash: string;
  branch?: { name: string; base: string };
  /** Solo kind "app": la entrada normalizada de app_plan (se re-planifica con ella al aplicar). */
  app?: Record<string, unknown>;
  mac: string;
}

export class PlanStore {
  constructor(private readonly ctx: Pick<Ctx, "paths" | "now">) {}

  private async key(): Promise<Buffer> {
    const file = planKeyFile(this.ctx.paths);
    try {
      return Buffer.from((await readFile(file, "utf8")).trim(), "hex");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    await ensurePrivateDir(dirname(file));
    const k = randomBytes(32);
    await writeFile(file, k.toString("hex") + "\n", { mode: 0o600, flag: "wx" }).catch(async (e: NodeJS.ErrnoException) => {
      if (e.code !== "EEXIST") throw e;
    });
    return Buffer.from((await readFile(file, "utf8")).trim(), "hex");
  }

  private async mac(rest: Omit<StoredPlan, "mac">): Promise<string> {
    return createHmac("sha256", await this.key()).update(stableStringify(rest)).digest("hex");
  }

  async save(plan: Omit<StoredPlan, "mac">): Promise<StoredPlan> {
    const full: StoredPlan = { ...plan, mac: await this.mac(plan) };
    const dir = plansDir(this.ctx.paths);
    await ensurePrivateDir(dir);
    const file = join(dir, `${plan.id}.json`);
    await writeFile(file, JSON.stringify(full, null, 2), { mode: 0o600 });
    await chmod(file, 0o600);
    return full;
  }

  async delete(id: string): Promise<void> {
    if (!PLAN_ID_RE.test(id)) return;
    await unlink(join(plansDir(this.ctx.paths), `${id}.json`)).catch(() => undefined);
  }

  /** Carga y valida integridad y vigencia. No valida el estado del destino (eso lo hace apply). */
  async load(id: string): Promise<StoredPlan> {
    if (typeof id !== "string" || !PLAN_ID_RE.test(id)) throw new ShardevError("invalid_plan", "plan_id inválido.");
    let raw: string;
    try {
      raw = await readFile(join(plansDir(this.ctx.paths), `${id}.json`), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new ShardevError("invalid_plan", "No existe ese plan (¿ya se aplicó o expiró y se limpió?). Genera uno nuevo con project_plan.");
      throw e;
    }
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new ShardevError("plan_tampered", "El archivo del plan no es JSON válido: posible manipulación.");
    }
    const { mac, ...rest } = obj;
    const expected = await this.mac(rest as Omit<StoredPlan, "mac">);
    const a = Buffer.from(typeof mac === "string" ? mac : "", "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b) || rest.id !== id) {
      throw new ShardevError("plan_tampered", "El plan no supera la verificación de integridad (modificado tras crearse). Se rechaza.");
    }
    const plan = obj as unknown as StoredPlan;
    if (this.ctx.now().getTime() > Date.parse(plan.expires_at)) {
      throw new ShardevError("plan_expired", `El plan expiró (${plan.expires_at}). Genera uno nuevo con project_plan.`);
    }
    return plan;
  }
}

/** Raíz permitida real que contiene al destino (estrictamente dentro). */
export async function assertTargetAllowed(ctx: Pick<Ctx, "paths">, target: string): Promise<string> {
  const abs = resolve(target);
  if (target !== abs && target.replace(/\/+$/, "") !== abs) {
    throw new ShardevError("target_not_allowed", "El destino debe ser una ruta absoluta normalizada (sin `..` ni segmentos relativos).");
  }
  const roots = (await loadConfig(ctx.paths)).allowed_roots;
  if (roots.length === 0) {
    throw new ShardevError("target_not_allowed", "No hay raíces permitidas: define allowed_roots en ~/.config/shardev-mcp/config.yaml.");
  }
  // Resuelve symlinks del ancestro existente más cercano.
  let existing = abs;
  const rest: string[] = [];
  for (;;) {
    try {
      existing = await realpath(existing);
      break;
    } catch {
      const parent = dirname(existing);
      if (parent === existing) throw new ShardevError("target_not_allowed", "Ruta de destino inválida.");
      rest.unshift(basename(existing));
      existing = parent;
    }
  }
  const real = join(existing, ...rest);
  for (const r of roots) {
    const rr = await realpath(r).catch(() => null);
    if (rr && real.startsWith(rr.replace(/\/+$/, "") + sep)) return real;
  }
  throw new ShardevError("target_not_allowed", `El destino queda fuera de las raíces permitidas (allowed_roots).`);
}

/** El destino de project_create debe estar ausente o ser un directorio vacío. */
export async function createTargetFree(target: string): Promise<string | null> {
  try {
    const st = await lstat(target);
    if (st.isSymbolicLink() || !st.isDirectory()) return `${target} existe y no es un directorio vacío`;
    return (await readdir(target)).length === 0 ? null : `${target} no está vacío`;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/** Lee archivos de un repo existente rechazando symlinks en la ruta. */
export function repoReader(root: string): BaseReader {
  return {
    async read(rel) {
      const full = resolveInside(root, rel);
      await assertNoSymlinks(root, rel);
      try {
        const st = await lstat(full);
        if (!st.isFile()) throw new ShardevError("apply_failed", `${rel} existe y no es un archivo regular`);
        return await readFile(full);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
  };
}

export interface RepoState {
  head: string;
  branch: string;
  problems: string[];
}
export async function repoState(ctx: Pick<Ctx, "runner">, repo: string): Promise<RepoState> {
  const problems: string[] = [];
  const top = await git(ctx, repo, ["rev-parse", "--show-toplevel"], { allowFail: true });
  if (!top.ok || (await realpath(top.out)) !== (await realpath(repo))) problems.push("el destino no es la raíz de un repositorio git");
  const head = await git(ctx, repo, ["rev-parse", "--verify", "HEAD"], { allowFail: true });
  if (!head.ok) problems.push("el repositorio no tiene commits");
  const br = await git(ctx, repo, ["symbolic-ref", "--short", "-q", "HEAD"], { allowFail: true });
  if (!br.ok) problems.push("HEAD está desacoplado (detached); parte de una rama");
  else if (PROTECTED_BRANCHES.test(br.out)) problems.push(`la rama actual es ${br.out}: nunca se trabaja sobre master/main ni se parte de ellas; cambia a develop (u otra) primero`);
  const st = await git(ctx, repo, ["status", "--porcelain=v1", "--untracked-files=all"], { allowFail: true });
  if (!st.ok) problems.push("no se pudo leer git status");
  else if (st.out !== "") problems.push("el árbol de trabajo no está limpio (hay cambios sin commit o archivos sin seguimiento)");
  return { head: head.out, branch: br.out, problems };
}

export function existingTargetHash(state: Pick<RepoState, "head" | "branch">, out: BuiltOutput): string {
  return sha(stableStringify({ head: state.head, branch: state.branch, touched: out.files.map((f) => [f.path, f.before ? sha(f.before) : "absent"]) }));
}
export const CREATE_TARGET_HASH = sha("create:free");

export interface PlanResult {
  plan_id: string | null;
  kind: "create" | "existing";
  target: string;
  expires_at: string | null;
  branch?: { name: string; base: string };
  files_to_create: Array<{ path: string; bytes: number; mode: string; layer: string }>;
  edits: Array<{ file: string; type: string; layer: string; changed: boolean; diff: string }>;
  commands: Array<{ name: string; command: string; timeout_s: number; env: Record<string, string>; runs_in: "project_create" | "project_verify" }>;
  conflicts: string[];
  layers: string[];
  template_hash: string;
  target_hash: string;
}

function describe(out: BuiltOutput, extra: Partial<PlanResult> & Pick<PlanResult, "kind" | "target" | "target_hash">, conflicts: string[]): PlanResult {
  return {
    plan_id: null,
    expires_at: null,
    files_to_create: out.files.filter((f) => f.kind === "create").map((f) => ({ path: f.path, bytes: f.content.length, mode: f.mode.toString(8).padStart(4, "0"), layer: f.layer })),
    edits: out.edits,
    commands: out.steps.map((s) => ({ name: s.name, command: renderCommand(s.argv), timeout_s: s.timeout_s, env: s.env, runs_in: s.full ? "project_verify" : "project_create" })),
    conflicts,
    layers: out.layers,
    template_hash: out.template_hash,
    ...extra,
  };
}

async function persist(ctx: Ctx, result: PlanResult, spec: ProjectSpec, out: BuiltOutput, id: string, branch?: { name: string; base: string }): Promise<PlanResult> {
  const created = ctx.now();
  const plan: Omit<StoredPlan, "mac"> = {
    v: 1,
    id,
    kind: result.kind,
    created_at: created.toISOString(),
    expires_at: new Date(created.getTime() + PLAN_TTL_MS).toISOString(),
    spec,
    template_hash: out.template_hash,
    target: result.target,
    target_hash: result.target_hash,
    outputs_hash: out.outputs_hash,
    ...(branch ? { branch } : {}),
  };
  const saved = await new PlanStore(ctx).save(plan);
  return { ...result, plan_id: saved.id, expires_at: saved.expires_at };
}

const newPlanId = (): string => `plan_${randomBytes(16).toString("hex")}`;

/** project_plan para un proyecto nuevo. Puro respecto al destino: no crea nada salvo el plan guardado. */
export async function planCreate(ctx: Ctx, specInput: unknown, target: string): Promise<PlanResult> {
  const spec = resolveProjectSpec(specInput);
  const real = await assertTargetAllowed(ctx, target);
  const out = await buildOutputs(spec, ctx.templatesDir, emptyBase);
  const conflicts = [...out.conflicts];
  const busy = await createTargetFree(real);
  if (busy) conflicts.push(busy);
  const result = describe(out, { kind: "create", target: real, target_hash: CREATE_TARGET_HASH }, conflicts);
  if (conflicts.length > 0) return result;
  return persist(ctx, result, spec, out, newPlanId());
}

/** Plan sobre un repo existente (lo usará `app_create`). Exige árbol limpio y rama base distinta de master/main. */
export async function planExisting(ctx: Ctx, specInput: unknown, repo: string, opts: { label?: string } = {}): Promise<PlanResult> {
  const spec = resolveProjectSpec(specInput);
  const label = opts.label ?? "gen";
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(label)) throw new ShardevError("invalid_spec", "label de rama inválido");
  const real = await assertTargetAllowed(ctx, repo);
  const state = await repoState(ctx, real);
  const out = await buildOutputs(spec, ctx.templatesDir, repoReader(real));
  const id = newPlanId();
  const branch = { name: `shardev/${label}-${spec.name}-${id.slice(5, 13)}`, base: state.branch };
  if (!BRANCH_RE.test(branch.name)) throw new ShardevError("invalid_spec", "No se pudo derivar un nombre de rama válido.");
  const conflicts = [...state.problems.map((p) => `repo: ${p}`), ...out.conflicts];
  const result = describe(out, { kind: "existing", target: real, target_hash: existingTargetHash(state, out), branch }, conflicts);
  if (conflicts.length > 0) return result;
  return persist(ctx, result, spec, out, id, branch);
}
