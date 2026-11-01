import { createHash, randomBytes } from "node:crypto";
import { lstat, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { parse as parseYaml, stringify } from "yaml";
import { z } from "zod";
import { ShardevError } from "../core/errors.js";
import { renderCommand } from "../core/policy.js";
import type { Ctx } from "../ops/context.js";
import { loadAndCheck, writeFiles } from "./apply.js";
import { buildOutputs, LOCK_PATH, stableStringify, type BuiltOutput, type PlannedFile } from "./build.js";
import { git, PROTECTED_BRANCHES } from "./git.js";
import { loadLayers } from "./layers.js";
import { PLAN_TTL_MS, PlanStore, assertTargetAllowed, repoReader } from "./plan.js";
import { resolveInside } from "./safe-path.js";
import { APP_FEATURES, AppSpecInputSchema, SOCIAL_PROVIDERS, deriveApp, resolveProjectSpec, type AppSpec, type ProjectSpec } from "./spec.js";
import { forbiddenFor, loadLeftoverTerms, scanText, verifyTree, type VerifyResult } from "./verify.js";

const sha = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

/**
 * Claves que chocan con rutas, carpetas o servicios del propio proyecto (`/api/<key>`, `/<key>`,
 * `resources/react/<key>`, `build-<key>`, `routes/api/<key>.php`...) o con palabras que no pueden
 * ser nombre de clase. Se rechazan aunque nadie las use todavía.
 */
export const RESERVED_KEYS: readonly string[] = [
  "api", "app", "apps", "artisan", "assets", "auth", "authentications", "bootstrap", "broadcasting", "build", "cache", "config",
  "console", "database", "docs", "docker", "health", "hot", "horizon", "index", "login", "logout", "livewire", "node", "nova",
  "oauth", "packages", "public", "pulse", "resources", "routes", "shardev", "sanctum", "storage", "telescope", "test", "tests",
  "up", "vendor",
  // palabras reservadas de PHP que darían un nombre de clase inválido
  "abstract", "array", "bool", "callable", "class", "enum", "false", "float", "int", "interface", "iterable", "list", "match",
  "mixed", "never", "null", "object", "parent", "self", "static", "string", "trait", "true", "void",
];
/** Modelos que ya existen en el proyecto generado o que chocarían con clases del framework. */
const RESERVED_MODELS: readonly string[] = ["Account", "Model", "Role", "Permission", "Token", "Client", "AuthCode", "RefreshToken", "Session", "Migration", "Job"];
/** Tablas del framework, de Passport y de Spatie: una app no puede reclamarlas. */
const RESERVED_TABLES: readonly string[] = [
  "sessions", "cache", "cache_locks", "jobs", "job_batches", "failed_jobs", "migrations", "roles", "permissions", "model_has_roles",
  "model_has_permissions", "role_has_permissions", "password_reset_tokens", "personal_access_tokens", "oauth_auth_codes",
  "oauth_access_tokens", "oauth_refresh_tokens", "oauth_clients", "oauth_device_codes",
];
export const AppPlanInputSchema = z
  .object({
    project_path: z.string().min(1).max(500),
    key: AppSpecInputSchema.shape.key,
    user_type: AppSpecInputSchema.shape.user_type,
    provider: AppSpecInputSchema.shape.provider,
    table: AppSpecInputSchema.shape.table,
    model: AppSpecInputSchema.shape.model,
    api_guard: AppSpecInputSchema.shape.api_guard,
    session_guard: AppSpecInputSchema.shape.session_guard,
    port: AppSpecInputSchema.shape.port.optional(),
    build_dir: AppSpecInputSchema.shape.build_dir,
    /** Se valida contra los nombres conocidos en `computeAppPlan`; que su capa exista lo comprueba `buildOutputs`. */
    features: z.array(z.string()).default([]),
    social_providers: z.array(z.enum(SOCIAL_PROVIDERS)).default([]),
    auto_register: z.boolean().default(false),
  })
  .strict();
export type AppPlanInput = z.input<typeof AppPlanInputSchema>;

/** Entrada normalizada que se guarda en el plan (sin `project_path`; el destino va en `target`). */
type AppRequest = Omit<z.output<typeof AppPlanInputSchema>, "project_path"> & { port: number };

const LockSchema = z
  .object({
    version: z.literal(1),
    template_hash: z.string(),
    layers: z.array(z.string()),
    spec: z.unknown(),
    files: z.array(z.object({ path: z.string(), sha256: z.string() }).passthrough()),
  })
  .passthrough();

/** Quita comentarios PHP (de línea y de bloque) para no dar por buena una clase que solo aparece comentada. */
const stripPhpComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/^\s*#.*$/gm, "");

const reQuotedKey = (name: string): RegExp => new RegExp(`['"]${name}['"]\\s*=>`);

interface Computed {
  app: AppSpec;
  request: AppRequest;
  spec: ProjectSpec;
  out: BuiltOutput;
  conflicts: string[];
  notes: string[];
  target_hash: string;
}

/**
 * Núcleo de app_plan y de app_create: lee el estado ACTUAL del proyecto y calcula lo que haría.
 * No escribe nada. app_create lo vuelve a ejecutar al aplicar para comparar con el plan.
 */
async function computeAppPlan(ctx: Ctx, root: string, req: AppRequest): Promise<Computed> {
  // ---- entrada ---------------------------------------------------------------------------
  const unknownFeatures = req.features.filter((f) => !(APP_FEATURES as readonly string[]).includes(f));
  if (unknownFeatures.length > 0) {
    throw new ShardevError("invalid_input", `features: feature desconocida ${unknownFeatures.map((f) => `"${f}"`).join(", ")} (conocidas: ${APP_FEATURES.join(", ")}).`);
  }
  if (RESERVED_KEYS.includes(req.key)) {
    throw new ShardevError("invalid_input", `key "${req.key}" está reservada (choca con rutas, carpetas o palabras de PHP del proyecto); elige otra.`);
  }

  const st = await lstat(root).catch(() => null);
  if (!st || !st.isDirectory()) throw new ShardevError("not_shardev_project", `${root} no es un directorio existente.`);
  const base = repoReader(root);

  // ---- el proyecto: lock y spec ------------------------------------------------------------
  const lockBuf = await base.read(LOCK_PATH);
  if (lockBuf === null) {
    throw new ShardevError("not_shardev_project", `El proyecto no tiene ${LOCK_PATH}: no fue creado por shardev (project_create), así que app_create no lo toca.`);
  }
  let lockRaw: unknown;
  try {
    lockRaw = parseYaml(lockBuf.toString("utf8"));
  } catch {
    throw new ShardevError("not_shardev_project", `${LOCK_PATH} no es YAML válido.`);
  }
  const lockParsed = LockSchema.safeParse(lockRaw);
  if (!lockParsed.success) throw new ShardevError("not_shardev_project", `${LOCK_PATH} inválido (no es un lock de shardev versión 1).`);
  const lock = lockParsed.data;
  const current = resolveProjectSpec(lock.spec);

  // ---- colisiones con las apps declaradas --------------------------------------------------
  if (current.apps.some((a) => a.key === req.key)) {
    throw new ShardevError("invalid_spec", `key "${req.key}" ya está en uso por otra app del proyecto (${current.apps.map((a) => a.key).join(", ")}).`);
  }
  const model = req.model ?? deriveApp({ ...req, features: [], social_providers: [], auto_register: false }).model;
  if (RESERVED_MODELS.includes(model)) throw new ShardevError("invalid_input", `model "${model}" está reservado (choca con clases del framework o del proyecto).`);

  // ---- user_type existing: el modelo debe existir y extender Account ---------------------------
  let table = req.table;
  const modelFile = `app/Models/${model}.php`;
  const modelBuf = await base.read(modelFile);
  if (req.user_type === "existing") {
    if (modelBuf === null) {
      throw new ShardevError("invalid_input", `user_type "existing" exige que ${modelFile} exista (y extienda Account); no existe. Usa user_type "new" para crearlo.`);
    }
    const src = stripPhpComments(modelBuf.toString("utf8"));
    const ns = /^\s*namespace\s+App\\Models\s*;/m.test(src);
    const fq = new RegExp(`\\bclass\\s+${model}\\s+extends\\s+\\\\?Shardevcom\\\\Authentications\\\\Models\\\\Account\\b`).test(src);
    const short = new RegExp(`\\bclass\\s+${model}\\s+extends\\s+Account\\b`).test(src) && /^\s*use\s+Shardevcom\\Authentications\\Models\\Account\s*;/m.test(src);
    if (!ns || !(fq || short)) {
      throw new ShardevError(
        "invalid_input",
        `${modelFile} existe pero no es una cuenta válida: debe estar en el namespace App\\Models y declarar \`class ${model} extends Account\` (Shardevcom\\Authentications\\Models\\Account) directamente.`,
      );
    }
    const declared = /protected\s+\$table\s*=\s*['"]([A-Za-z0-9_]+)['"]/.exec(src)?.[1];
    if (declared) {
      if (table !== undefined && table !== declared) {
        throw new ShardevError("invalid_input", `table "${table}" no coincide con la tabla que declara ${modelFile} ("${declared}").`);
      }
      table = declared;
    }
  }
  if (table !== undefined && RESERVED_TABLES.includes(table)) throw new ShardevError("invalid_input", `table "${table}" está reservada (tabla del framework, Passport o Spatie).`);

  const appInput = AppSpecInputSchema.parse({
    key: req.key,
    user_type: req.user_type,
    port: req.port,
    ...(req.provider ? { provider: req.provider } : {}),
    ...(table ? { table } : {}),
    ...(req.model ? { model: req.model } : {}),
    ...(req.api_guard ? { api_guard: req.api_guard } : {}),
    ...(req.session_guard ? { session_guard: req.session_guard } : {}),
    ...(req.build_dir ? { build_dir: req.build_dir } : {}),
    features: req.features,
    social_providers: req.social_providers,
    auto_register: req.auto_register,
  });
  const app = deriveApp(appInput);
  if (RESERVED_TABLES.includes(app.table)) throw new ShardevError("invalid_input", `table "${app.table}" está reservada (tabla del framework, Passport o Spatie).`);

  let spec: ProjectSpec;
  try {
    spec = resolveProjectSpec({ ...current, apps: [...current.apps, app] });
  } catch (e) {
    if (e instanceof ShardevError && e.code === "invalid_spec") {
      throw new ShardevError("invalid_spec", e.message.replace("Spec inválido: ", "No se puede añadir la app: "));
    }
    throw e;
  }

  // ---- colisiones textuales con lo que el dueño haya escrito a mano --------------------------
  const conflicts: string[] = [];
  const notes: string[] = [];
  const authPhp = (await base.read("config/auth.php"))?.toString("utf8");
  if (authPhp !== undefined) {
    for (const g of new Set([app.api_guard, app.session_guard])) if (reQuotedKey(g).test(authPhp)) conflicts.push(`config/auth.php: ya declara "${g}" (guard o provider); no se duplica`);
    if (reQuotedKey(app.provider).test(authPhp)) conflicts.push(`config/auth.php: ya declara "${app.provider}" (guard o provider); no se duplica`);
  }
  const authnPhp = (await base.read("config/authentications.php"))?.toString("utf8");
  if (authnPhp !== undefined && reQuotedKey(app.key).test(authnPhp)) conflicts.push(`config/authentications.php: ya declara la app "${app.key}"`);

  // ---- renderizado: solo capas de app, solo esta app ---------------------------------------
  const layers = await loadLayers(ctx.templatesDir);
  const appLayers = new Set(layers.filter((l) => l.scope === "app").map((l) => l.name));
  const stepLayers = [...new Set([...lock.layers, ...appLayers])];
  const out = await buildOutputs(spec, ctx.templatesDir, base, {
    onlyApps: [app.key],
    stepLayers,
    lock: ({ files, prevLock, applied }) => nextLock(prevLock, spec, applied, files),
  });
  conflicts.push(...out.conflicts);

  for (const f of out.files) {
    if (f.path === LOCK_PATH) continue;
    if (!appLayers.has(f.layer)) throw new ShardevError("apply_failed", `Error interno: ${f.path} salió de la capa "${f.layer}", que no es de scope app.`);
    if (f.secret) conflicts.push(`${f.path}: una capa de app no puede generar secretos locales (capa ${f.layer})`);
  }
  for (const e of out.edits) {
    if (e.type !== "lock" && !e.changed && !e.idempotent) conflicts.push(`${e.file}: el edit ${e.type} de la capa ${e.layer} ya estaba aplicado (¿cambios manuales?); no se continúa a ciegas`);
  }

  // ---- notas informativas (no bloquean) -----------------------------------------------------
  const lockHashes = new Map(lock.files.map((f) => [f.path, f.sha256]));
  for (const f of out.files) {
    if (f.kind !== "edit" || f.path === LOCK_PATH || !f.before) continue;
    const recorded = lockHashes.get(f.path);
    if (recorded !== undefined && recorded !== sha(f.before)) notes.push(`${f.path} difiere del hash del lock (lo modificó el dueño): los edits por ancla se aplican igual y el hash del lock no se actualiza`);
  }
  if (lock.template_hash !== out.template_hash) notes.push("Las plantillas cambiaron desde que se creó el proyecto: la app se genera con las plantillas actuales; las capas de proyecto no se re-renderizan.");
  if (req.user_type === "existing" && modelBuf !== null && !/function\s+newFactory|HasFactory/.test(modelBuf.toString("utf8"))) {
    notes.push(`${modelFile} no define factory: los tests de aislamiento entre guards no cubrirán esta app (necesitan \`${model}::factory()\`).${req.features.length > 0 ? " Las pruebas generadas de las features también la usan y fallarán sin ella." : ""}`);
  }

  // ---- escaneo en memoria de lo que se va a escribir (archivos nuevos y líneas añadidas) ----------
  const forbidden = forbiddenFor(spec, await loadLeftoverTerms(ctx));
  for (const f of out.files) {
    if (f.path === LOCK_PATH || f.secret || f.content.includes(0)) continue;
    let text = f.content.toString("utf8");
    if (f.kind === "edit" && f.before) {
      const seen = new Map<string, number>();
      for (const l of f.before.toString("utf8").split("\n")) seen.set(l, (seen.get(l) ?? 0) + 1);
      // Solo las líneas añadidas (las demás se vacían para conservar la numeración): lo que ya tenía el dueño no es asunto del escaneo.
      text = text.split("\n").map((l) => {
        const n = seen.get(l) ?? 0;
        if (n > 0) {
          seen.set(l, n - 1);
          return "";
        }
        return l;
      }).join("\n");
    }
    const r = scanText(ctx, f.path, text, forbidden);
    for (const h of r.hits) conflicts.push(`${h.path}:${h.line}: posible secreto en lo que se va a escribir`);
    for (const h of r.leftovers) conflicts.push(`${h.path}:${h.line}: resto de otro proyecto (${h.term}) en lo que se va a escribir`);
  }

  // ---- git: misma regla que el resto del generador sobre master/main -------------------------------
  if (await lstat(resolveInside(root, ".git")).then(() => true, () => false)) {
    const br = await git(ctx, root, ["symbolic-ref", "--short", "-q", "HEAD"], { allowFail: true });
    if (br.ok && PROTECTED_BRANCHES.test(br.out)) conflicts.push(`repo: la rama actual es ${br.out}: nunca se trabaja sobre master/main; cambia a develop (u otra) primero`);
  }

  // ---- estado al que queda atado el plan ---------------------------------------------------------
  const target_hash = sha(
    stableStringify({
      touched: out.files.map((f) => [f.path, f.before ? sha(f.before) : "absent"]),
      witness: [[modelFile, modelBuf ? sha(modelBuf) : "absent"], ["config/auth.php", authPhp !== undefined ? sha(authPhp) : "absent"], ["config/authentications.php", authnPhp !== undefined ? sha(authnPhp) : "absent"]],
      lock: sha(lockBuf),
      app: app.key,
    }),
  );

  return { app, request: { ...req, ...(table ? { table } : {}) }, spec, out, conflicts, notes, target_hash };
}

/** Lock actualizado: spec con la app nueva, capas, y hashes de los archivos nuevos y editados sin deriva. */
function nextLock(prevLock: Buffer, spec: ProjectSpec, applied: string[], files: PlannedFile[]): string {
  const lock = parseYaml(prevLock.toString("utf8")) as Record<string, unknown> & { layers: string[]; files: Array<{ path: string; sha256: string }> };
  const byPath = new Map(lock.files.map((f) => [f.path, f]));
  for (const f of files) {
    if (f.secret) continue;
    if (f.kind === "create") byPath.set(f.path, { path: f.path, sha256: sha(f.content) });
    else if (f.before) {
      const rec = byPath.get(f.path);
      // Solo se actualiza si el archivo seguía como lo dejó shardev: una deriva del dueño sigue siendo visible.
      if (rec && rec.sha256 === sha(f.before)) byPath.set(f.path, { ...rec, sha256: sha(f.content) });
    }
  }
  lock.spec = spec;
  lock.layers = [...new Set([...lock.layers, ...applied])];
  lock.files = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  return stringify(lock);
}

/** Primer puerto libre desde 5173 que no use ninguna app declarada. */
function freePort(spec: ProjectSpec): number {
  const used = new Set(spec.apps.map((a) => a.port));
  for (let p = 5173; p <= 65535; p++) if (!used.has(p)) return p;
  throw new ShardevError("invalid_spec", "No quedan puertos libres.");
}

export interface AppPlanResult {
  plan_id: string | null;
  kind: "app";
  target: string;
  expires_at: string | null;
  app: AppSpec;
  files_to_create: Array<{ path: string; bytes: number; mode: string; layer: string }>;
  edits: Array<{ file: string; type: string; layer: string; changed: boolean; diff: string; idempotent?: true }>;
  commands: Array<{ name: string; command: string; timeout_s: number; env: Record<string, string>; runs_in: "app_create" | "project_verify" }>;
  conflicts: string[];
  notes: string[];
  layers: string[];
  template_hash: string;
  target_hash: string;
}

async function parseRequest(ctx: Ctx, input: unknown): Promise<{ root: string; req: AppRequest }> {
  const r = AppPlanInputSchema.safeParse(input);
  if (!r.success) {
    throw new ShardevError("invalid_input", `Entrada inválida: ${r.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ")}`);
  }
  const { project_path, port, ...rest } = r.data;
  const root = await assertTargetAllowed(ctx, project_path);
  const st = await lstat(root).catch(() => null);
  if (!st || !st.isDirectory()) throw new ShardevError("not_shardev_project", `${root} no es un directorio existente.`);
  // El puerto por defecto depende del spec del proyecto: se resuelve leyendo el lock (computeAppPlan lo vuelve a validar).
  let p = port;
  if (p === undefined) {
    const lockBuf = await repoReader(root).read(LOCK_PATH);
    if (lockBuf === null) throw new ShardevError("not_shardev_project", `El proyecto no tiene ${LOCK_PATH}: no fue creado por shardev (project_create), así que app_create no lo toca.`);
    try {
      p = freePort(resolveProjectSpec((parseYaml(lockBuf.toString("utf8")) as { spec?: unknown }).spec));
    } catch (e) {
      if (e instanceof ShardevError) throw new ShardevError("not_shardev_project", `${LOCK_PATH} inválido: ${e.message}`);
      throw new ShardevError("not_shardev_project", `${LOCK_PATH} no es YAML válido.`);
    }
  }
  return { root, req: { ...rest, port: p } };
}

/** app_plan: calcula lo que haría app_create sobre el proyecto. Solo guarda el plan (nunca toca el proyecto). */
export async function planApp(ctx: Ctx, input: unknown): Promise<AppPlanResult> {
  const { root, req } = await parseRequest(ctx, input);
  const c = await computeAppPlan(ctx, root, req);
  const result: AppPlanResult = {
    plan_id: null,
    kind: "app",
    target: root,
    expires_at: null,
    app: c.app,
    files_to_create: c.out.files.filter((f) => f.kind === "create").map((f) => ({ path: f.path, bytes: f.content.length, mode: f.mode.toString(8).padStart(4, "0"), layer: f.layer })),
    edits: c.out.edits,
    commands: c.out.steps.map((s) => ({ name: s.name, command: renderCommand(s.argv), timeout_s: s.timeout_s, env: s.env, runs_in: s.full ? "project_verify" : "app_create" })),
    conflicts: c.conflicts,
    notes: c.notes,
    layers: c.out.layers,
    template_hash: c.out.template_hash,
    target_hash: c.target_hash,
  };
  if (c.conflicts.length > 0) return result;
  const created = ctx.now();
  const id = `plan_${randomBytes(16).toString("hex")}`;
  const saved = await new PlanStore(ctx).save({
    v: 1,
    id,
    kind: "app",
    created_at: created.toISOString(),
    expires_at: new Date(created.getTime() + PLAN_TTL_MS).toISOString(),
    spec: c.spec,
    template_hash: c.out.template_hash,
    target: root,
    target_hash: c.target_hash,
    outputs_hash: c.out.outputs_hash,
    app: { ...c.request },
  });
  return { ...result, plan_id: saved.id, expires_at: saved.expires_at };
}

export interface AppApplyResult {
  ok: boolean;
  kind: "app";
  target: string;
  app: string;
  files_created: number;
  files_edited: number;
  /** En fallo: true si todo lo escrito se deshizo. */
  rolled_back?: boolean;
  verify?: VerifyResult;
  message: string;
}

export interface AppApplyHooks {
  /** Solo pruebas: se llama tras escribir cada archivo; si lanza, se revierte todo. */
  afterWrite?: (path: string) => void | Promise<void>;
}

/**
 * app_create: aplica un plan de app. Re-planifica contra el estado actual y exige que coincida con el plan
 * (archivos tocados, lock y salida). Escribe primero los archivos nuevos, luego los edits y el lock al final;
 * ante cualquier fallo restaura los editados y borra los creados.
 */
export async function applyApp(ctx: Ctx, planId: string, hooks: AppApplyHooks = {}): Promise<AppApplyResult> {
  const plan = await loadAndCheck(ctx, planId, "app");
  const root = await assertTargetAllowed(ctx, plan.target);
  if (root !== plan.target) throw new ShardevError("plan_stale", "El proyecto resuelve a otra ruta que en el plan.");
  const replan = "Genera un plan nuevo con app_plan.";
  const stored = plan.app as (Partial<AppRequest> & Pick<AppRequest, "key" | "user_type" | "port">) | undefined;
  if (!stored) throw new ShardevError("invalid_plan", "El plan no trae la entrada de la app.");

  let c: Computed;
  try {
    c = await computeAppPlan(ctx, root, { features: [], social_providers: [], auto_register: false, ...stored });
  } catch (e) {
    if (e instanceof ShardevError) throw new ShardevError("plan_stale", `El proyecto cambió desde el plan y ya no es válido: ${e.message} ${replan}`);
    throw e;
  }
  if (c.conflicts.length > 0) throw new ShardevError("plan_stale", `Ahora hay conflictos: ${c.conflicts.slice(0, 3).join("; ")}. ${replan}`);
  if (c.target_hash !== plan.target_hash) {
    throw new ShardevError("plan_stale", `Un archivo relevante (los que toca la app, el lock, config/auth.php, config/authentications.php o el modelo) cambió entre el plan y la aplicación. ${replan}`);
  }
  if (c.out.outputs_hash !== plan.outputs_hash) throw new ShardevError("plan_stale", `La salida regenerada no coincide con la del plan. ${replan}`);
  if (stableStringify(c.spec) !== stableStringify(plan.spec)) throw new ShardevError("plan_stale", `El spec del proyecto cambió. ${replan}`);

  const out = c.out;
  // Orden: nuevos, edits y, al final, el lock (la última escritura es la que declara la app).
  const ordered: PlannedFile[] = [
    ...out.files.filter((f) => f.kind === "create"),
    ...out.files.filter((f) => f.kind === "edit" && f.path !== LOCK_PATH),
    ...out.files.filter((f) => f.path === LOCK_PATH),
  ];
  const created = { files: [] as string[], dirs: [] as string[] };
  const touchedEdits: PlannedFile[] = [];
  const rollback = async (): Promise<string[]> => {
    const problems: string[] = [];
    for (const f of touchedEdits.reverse()) {
      const full = resolveInside(root, f.path);
      // Si el archivo sigue idéntico al original (la escritura ni empezó), no hay nada que restaurar.
      if ((await readFile(full).catch(() => null))?.equals(f.before!)) continue;
      await writeFile(full, f.before!).catch((e: Error) => problems.push(`no se pudo restaurar ${f.path}: ${e.message}`));
    }
    for (const p of created.files) await rm(p, { force: true }).catch((e: Error) => problems.push(`no se pudo borrar ${p}: ${e.message}`));
    for (const d of [...created.dirs].reverse()) await rmdir(d).catch(() => undefined);
    return problems;
  };
  const fail = async (message: string, verify?: VerifyResult): Promise<AppApplyResult> => {
    const problems = await rollback();
    return {
      ok: false,
      kind: "app",
      target: root,
      app: c.app.key,
      files_created: 0,
      files_edited: 0,
      rolled_back: problems.length === 0,
      ...(verify ? { verify } : {}),
      message: problems.length === 0 ? `${message} Se revirtió todo: los archivos editados se restauraron y los creados se borraron.` : `${message} La reversión tuvo problemas: ${problems.join("; ")}.`,
    };
  };

  try {
    await writeFiles(root, ordered, created, {
      beforeEdit: (f) => void touchedEdits.push(f),
      afterEach: async (f) => hooks.afterWrite?.(f.path),
    });
  } catch (e) {
    return fail(`Falló la escritura: ${e instanceof Error ? e.message : String(e)}.`);
  }
  const scan = out.files.filter((f) => f.kind === "create" && !f.secret).map((f) => f.path);
  const verify = await verifyTree(ctx, root, out.steps.filter((s) => !s.full), scan, forbiddenFor(c.spec, await loadLeftoverTerms(ctx)));
  if (!verify.ok) return fail(`La verificación falló: ${verify.summary}.`, verify);

  await new PlanStore(ctx).delete(plan.id);
  const nCreated = out.files.filter((f) => f.kind === "create").length;
  const nEdited = out.files.length - nCreated;
  return {
    ok: true,
    kind: "app",
    target: root,
    app: c.app.key,
    files_created: nCreated,
    files_edited: nEdited,
    verify,
    message: `App "${c.app.key}" añadida en ${root} (${nCreated} archivos nuevos, ${nEdited} editados, sin commit, sin migraciones). ${verify.summary}. Siguiente paso: project_verify para correr composer, migraciones, tests y builds.`,
  };
}

