import { createHash } from "node:crypto";
import { parse as parseYaml, stringify } from "yaml";
import { ShardevError } from "../core/errors.js";
import { unifiedDiff } from "./diff.js";
import { loadLayers, readLayerFile, templateHash, walk, type Layer, type VerifyStepDef } from "./layers.js";
import { APP_FEATURES, SOCIAL_PROVIDERS, type AppSpec, type ProjectSpec } from "./spec.js";
import { evalCondition, render, type RenderOptions, type Vars } from "./render.js";
import { safeRel } from "./safe-path.js";
import { applyInsert, applyJsonMerge, applyYamlAppend, WiringError } from "./wiring.js";

export const LOCK_PATH = ".ops/lock.yaml";
export const GENERATOR_VERSION = 1;

/** Lee el estado base (proyecto existente o vacío). `null` = no existe. */
export interface BaseReader {
  read(rel: string): Promise<Buffer | null>;
}
export const emptyBase: BaseReader = { read: async () => null };

export interface PlannedFile {
  path: string;
  kind: "create" | "edit";
  content: Buffer;
  /** Contenido previo (solo edit). */
  before?: Buffer;
  mode: number;
  layer: string;
  /** Contiene marcadores de secreto local: se sustituyen por valores aleatorios al aplicar; no se hashea ni se escanea. */
  secret?: boolean;
}
export interface PlannedEdit {
  file: string;
  type: string;
  layer: string;
  changed: boolean;
  diff: string;
}
export interface PlannedStep extends VerifyStepDef {
  layer: string;
}

/**
 * Secretos locales que el generador crea al aplicar (nunca al planear: el plan es reproducible).
 * En las plantillas se escriben como `{{ secret.<nombre> }}`, que se renderiza a un marcador.
 */
export const LOCAL_SECRETS = ["app_key", "db_password", "db_root_password", "redis_password"] as const;
export const SECRET_MARK_RE = /@@SHARDEV_SECRET:([a-z_]+)@@/g;
const secretMark = (n: string): string => `@@SHARDEV_SECRET:${n}@@`;
export interface BuiltOutput {
  files: PlannedFile[];
  edits: PlannedEdit[];
  steps: PlannedStep[];
  layers: string[];
  conflicts: string[];
  template_hash: string;
  outputs_hash: string;
}

const sha = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}

const flags = (all: readonly string[], on: readonly string[]): Record<string, boolean> => Object.fromEntries(all.map((f) => [f, on.includes(f)]));

function projectVars(spec: ProjectSpec): Vars {
  return {
    name: spec.name,
    domain: spec.domain,
    features: spec.features,
    feature: Object.fromEntries(spec.features.map((f) => [f, true])),
    app_keys: spec.apps.map((a) => a.key),
    has_mobile: spec.mobile !== undefined,
    // La primera app es la principal: su guard/provider son los valores por defecto de auth.php.
    primary_app: spec.apps[0]!.key,
    primary_api_guard: spec.apps[0]!.api_guard,
    primary_session_guard: spec.apps[0]!.session_guard,
    primary_provider: spec.apps[0]!.provider,
  };
}
function appVars(a: AppSpec): Vars {
  return {
    ...a,
    // Nombres de clase completos derivados. En las plantillas `\{{` es un escape del renderer, así que
    // un namespace seguido de una variable (`App\Models\{{ app.model }}`) no se puede escribir.
    model_class: `App\\Models\\${a.model}`,
    factory_class: `Database\\Factories\\${a.model}Factory`,
    controller_class: `App\\Http\\Controllers\\${a.model}AuthController`,
    // Clases de las features (carpetas app/Auth/Otp y app/Auth/Social): se pasan ya compuestas por el mismo motivo.
    otp_controller_class: `App\\Auth\\Otp\\${a.model}OtpController`,
    otp_mail_class: `App\\Auth\\Otp\\${a.model}LoginCodeMail`,
    social_controller_class: `App\\Auth\\Social\\${a.model}SocialController`,
    social_identity_class: `App\\Auth\\Social\\${a.model}SocialIdentity`,
    is_new: a.user_type === "new",
    is_existing: a.user_type === "existing",
    social_providers_csv: a.social_providers.join(","),
    // Lista lista para pegar en un array PHP: 'google', 'microsoft'
    social_providers_php: a.social_providers.map((p) => `'${p}'`).join(", "),
    key_upper: a.key.toUpperCase(),
    feature: flags(APP_FEATURES, a.features),
    social: flags(SOCIAL_PROVIDERS, a.social_providers),
  };
}

interface Instance {
  vars: Vars;
  label: string;
}
function instances(layer: Layer, spec: ProjectSpec, onlyApps?: readonly string[]): Instance[] {
  const project = projectVars(spec);
  const secret = Object.fromEntries(LOCAL_SECRETS.map((n) => [n, secretMark(n)]));
  if (onlyApps && layer.scope !== "app") return []; // modo app_create: las capas de proyecto/mobile nunca se renderizan
  if (layer.scope === "project") return [{ vars: { project, secret }, label: "project" }];
  if (layer.scope === "app") return spec.apps.filter((a) => !onlyApps || onlyApps.includes(a.key)).map((a) => ({ vars: { project, secret, app: appVars(a) }, label: `app:${a.key}` }));
  if (!spec.mobile) return [];
  const app = spec.apps.find((a) => a.key === spec.mobile!.app);
  if (!app) return [];
  const m = spec.mobile;
  return [{ vars: { project, secret, app: appVars(app), mobile: { ...m, platforms: m.platforms, android: m.platforms.includes("android"), ios: m.platforms.includes("ios") } }, label: "mobile" }];
}

const LENIENT = ["project.feature"] as const;

/**
 * Una feature solo se puede pedir si hay al menos una capa que la use (`when: app.feature.<x>`).
 * Así `mfa` e `invitations` siguen rechazadas hasta que exista su capa, sin lista aparte que se desincronice.
 */
export function assertFeatureLayers(layers: Layer[], spec: ProjectSpec): void {
  const has = (f: string): boolean => layers.some((l) => l.scope === "app" && l.when?.trim() === `app.feature.${f}`);
  const missing = [...new Set(spec.apps.flatMap((a) => a.features))].filter((f) => !has(f));
  if (missing.length > 0) {
    throw new ShardevError("invalid_spec", `Spec inválido: la capa de la feature ${missing.map((f) => `"${f}"`).join(", ")} todavía no existe (se añadirá en una tarea posterior).`);
  }
}

function renderDeep(value: unknown, vars: Vars, opts: RenderOptions, name: string): unknown {
  if (typeof value === "string") return render(value, vars, opts, name);
  if (Array.isArray(value)) return value.map((v) => renderDeep(v, vars, opts, name));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [render(k, vars, opts, name), renderDeep(v, vars, opts, name)]));
  }
  return value;
}

/** Calcula los pasos de verificación (sin tocar ningún archivo). */
export function collectSteps(layers: Layer[], spec: ProjectSpec): PlannedStep[] {
  const out: PlannedStep[] = [];
  const seen = new Set<string>();
  for (const layer of layers) {
    for (const inst of instances(layer, spec)) {
      const opts: RenderOptions = { lenientParents: LENIENT };
      if (layer.when && !evalCondition(layer.when, inst.vars, opts, `${layer.name}.when`)) continue;
      for (const s of layer.verify) {
        const where = `${layer.name}.verify.${s.name}`;
        const step: PlannedStep = {
          name: s.name,
          layer: layer.name,
          argv: s.argv.map((x) => render(x, inst.vars, opts, where)),
          timeout_s: s.timeout_s,
          full: s.full,
          env: Object.fromEntries(Object.entries(s.env).map(([k, v]) => [k, render(v, inst.vars, opts, where)])),
        };
        const key = stableStringify([step.name, step.argv, step.env]);
        if (!seen.has(key)) {
          seen.add(key);
          out.push(step);
        }
      }
    }
  }
  return out;
}

/**
 * Núcleo puro del generador: plantillas + spec + estado base => archivos, edits, pasos y conflictos.
 * No escribe nada. Errores de plantilla (variable desconocida, bloque sin cerrar, requerida sin usar)
 * lanzan ShardevError; problemas de cableado/colisiones se devuelven como `conflicts`.
 */
export interface BuildOptions {
  /**
   * Modo `app_create`: solo se renderizan las capas de scope `app` y solo para estas apps; las capas
   * de proyecto nunca se vuelven a renderizar. `spec` debe ser el spec completo (con la app nueva).
   */
  onlyApps?: readonly string[];
  /** Capas cuyos pasos de verificación se calculan (por defecto, las aplicadas). */
  stepLayers?: readonly string[];
  /**
   * Con `onlyApps`: produce el texto del lock actualizado a partir del lock previo (obligatorio ahí);
   * el lock completo de `project_create` (plantilla, paquetes, secretos locales) no se recalcula.
   */
  lock?: (input: { files: PlannedFile[]; prevLock: Buffer; applied: string[] }) => string;
}

export async function buildOutputs(spec: ProjectSpec, templatesDir: string, base: BaseReader, options: BuildOptions = {}): Promise<BuiltOutput> {
  const layers = await loadLayers(templatesDir);
  assertFeatureLayers(layers, spec);
  const overlay = new Map<string, Buffer>();
  const created = new Map<string, PlannedFile>();
  const edited = new Map<string, { before: Buffer; layer: string }>();
  const edits: PlannedEdit[] = [];
  const conflicts: string[] = [];
  const applied: string[] = [];

  const get = async (rel: string): Promise<Buffer | null> => overlay.get(rel) ?? (await base.read(rel));

  for (const layer of layers) {
    const used = new Set<string>();
    const conflictsBefore = conflicts.length;
    let ran = false;
    for (const inst of instances(layer, spec, options.onlyApps)) {
      const opts: RenderOptions = { used, lenientParents: LENIENT };
      if (layer.when && !evalCondition(layer.when, inst.vars, opts, `${layer.name}.when`)) continue;
      ran = true;
      const where = (what: string): string => `${layer.name}/${what}[${inst.label}]`;

      for (const f of layer.files) {
        const items: Array<{ dest: string; content: Buffer; raw: boolean }> = [];
        if (f.tree !== undefined) {
          const tree = safeRel(f.tree.replace(/\/+$/, ""), `${layer.name}: tree`);
          const baseDest = render(f.dest, inst.vars, opts, where(`dest ${f.dest}`));
          for (const rel of await walk(layer.dir, tree)) {
            const inner = rel.slice(tree.length + 1);
            const doRender = f.render.some((m) => inner === m || inner.endsWith(m));
            const dest = safeRel(`${baseDest === "." ? "" : baseDest + "/"}${render(inner, inst.vars, opts, where(`dest ${rel}`))}`, `${layer.name}: destino`);
            items.push({ dest, content: await readLayerFile(layer, rel), raw: !doRender });
          }
        } else {
          const dest = safeRel(render(f.dest, inst.vars, opts, where(`dest ${f.dest}`)), `${layer.name}: destino`);
          items.push({ dest, content: await readLayerFile(layer, f.src!), raw: f.raw ?? false });
        }
        for (const it of items) {
          const content = it.raw ? it.content : Buffer.from(render(it.content.toString("utf8"), inst.vars, opts, where(f.src ?? it.dest)), "utf8");
          if ((await get(it.dest)) !== null) {
            conflicts.push(`${it.dest}: ya existe (capa ${layer.name}); no se sobrescribe`);
            continue;
          }
          const isSecret = !it.raw && content.toString("utf8").includes("@@SHARDEV_SECRET:");
          overlay.set(it.dest, content);
          created.set(it.dest, { path: it.dest, kind: "create", content, mode: isSecret ? 0o600 : f.mode ? parseInt(f.mode, 8) : 0o644, layer: layer.name, ...(isSecret ? { secret: true } : {}) });
        }
      }

      for (const e of layer.edits) {
        const file = safeRel(render(e.file, inst.vars, opts, where("edit.file")), `${layer.name}: edit.file`);
        const before = await get(file);
        if (before === null) {
          conflicts.push(`${file}: no existe; el edit ${e.type} de la capa ${layer.name} no tiene sobre qué actuar`);
          continue;
        }
        const w = where(`edit ${e.type} ${file}`);
        try {
          const text = before.toString("utf8");
          let after: string;
          if (e.type === "json-merge") {
            after = applyJsonMerge(text, renderDeep(e.value, inst.vars, opts, w) as Record<string, unknown>, file);
          } else if (e.type === "yaml-append") {
            after = applyYamlAppend(text, e.path.map((p) => render(p, inst.vars, opts, w)), renderDeep(e.value, inst.vars, opts, w), file);
          } else {
            after = applyInsert(text, { anchor: render(e.anchor, inst.vars, opts, w), position: e.position, content: render(e.content, inst.vars, opts, w), indent: e.indent }, file);
          }
          const changed = after !== text;
          edits.push({ file, type: e.type, layer: layer.name, changed, diff: unifiedDiff(file, text, after) });
          if (changed) {
            overlay.set(file, Buffer.from(after, "utf8"));
            if (!created.has(file) && !edited.has(file)) edited.set(file, { before, layer: layer.name });
          }
        } catch (err) {
          if (err instanceof WiringError) {
            conflicts.push(`${err.message} (capa ${layer.name})`);
            continue;
          }
          throw err;
        }
      }
    }
    if (ran) {
      applied.push(layer.name);
      // Con conflictos en la capa, parte de sus plantillas no se evaluó: reportar "sin usar" sería engañoso.
      for (const r of conflicts.length > conflictsBefore ? [] : layer.requires) {
        if (!used.has(r)) throw new ShardevError("invalid_template", `Capa ${layer.name}: la variable requerida "${r}" no se usa en ninguna plantilla ni edit`);
      }
    }
  }

  const files: PlannedFile[] = [...created.values()];
  for (const [path, { before, layer }] of edited) {
    // si un archivo creado fue luego editado, el contenido final ya está en `created` vía overlay
    files.push({ path, kind: "edit", content: overlay.get(path)!, before, mode: 0o644, layer });
  }
  for (const f of files) if (f.kind === "create") f.content = overlay.get(f.path) ?? f.content;

  const thash = await templateHash(templatesDir);
  const prevLock = await get(LOCK_PATH);
  let lockText: string;
  if (options.lock) {
    // app_create: el lock existente se actualiza (spec, capas, hashes de archivos); nada más se recalcula.
    if (!prevLock) {
      conflicts.push(`${LOCK_PATH}: no existe; el proyecto no fue creado por shardev`);
      lockText = "";
    } else {
      lockText = options.lock({ files, prevLock, applied });
    }
  } else {
    // Lock: plantilla + capas + spec (sin secretos: el spec es estricto y no tiene campos de secreto) + hashes.
    let layersInLock = applied;
    if (prevLock) {
      try {
        const prev = parseYaml(prevLock.toString("utf8")) as { layers?: unknown };
        if (Array.isArray(prev.layers)) layersInLock = [...new Set([...prev.layers.filter((x): x is string => typeof x === "string"), ...applied])];
      } catch {
        conflicts.push(`${LOCK_PATH}: no es YAML válido`);
      }
    }
    // Hash por paquete copiado (packages/<vendor>/<nombre>/**): detecta cambios locales en las copias.
    const pkgHashes = new Map<string, ReturnType<typeof createHash>>();
    for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
      const m = /^packages\/([^/]+)\/([^/]+)\//.exec(f.path);
      if (!m) continue;
      const key = `${m[1]}/${m[2]}`;
      if (!pkgHashes.has(key)) pkgHashes.set(key, createHash("sha256"));
      pkgHashes.get(key)!.update(f.path).update("\0").update(sha(f.content)).update("\0");
    }
    lockText = stringify({
      version: GENERATOR_VERSION,
      generator: "shardev-mcp",
      template_hash: thash,
      layers: layersInLock,
      spec,
      // Los archivos con secretos locales no se registran (su contenido es aleatorio por proyecto).
      files: files.filter((f) => !f.secret).map((f) => ({ path: f.path, sha256: sha(f.content) })).sort((a, b) => a.path.localeCompare(b.path)),
      local_files: files.filter((f) => f.secret).map((f) => f.path).sort(),
      packages: Object.fromEntries([...pkgHashes].sort(([a], [b]) => a.localeCompare(b)).map(([k, h]) => [k, h.digest("hex")])),
    });
  }
  if (!options.lock || prevLock) {
    const lockContent = Buffer.from(lockText, "utf8");
    if (prevLock) {
      files.push({ path: LOCK_PATH, kind: "edit", content: lockContent, before: prevLock, mode: 0o644, layer: "(lock)" });
      edits.push({ file: LOCK_PATH, type: "lock", layer: "(lock)", changed: !prevLock.equals(lockContent), diff: unifiedDiff(LOCK_PATH, prevLock.toString("utf8"), lockText) });
    } else {
      files.push({ path: LOCK_PATH, kind: "create", content: lockContent, mode: 0o644, layer: "(lock)" });
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  const stepLayers = options.stepLayers ?? applied;
  const steps = collectSteps(layers.filter((l) => stepLayers.includes(l.name)), spec);
  const outputs_hash = sha(
    stableStringify({
      files: files.map((f) => [f.path, f.kind, f.mode, sha(f.content)]),
      steps: steps.map((s) => [s.name, s.argv, s.env, s.timeout_s, s.full]),
      layers: applied,
      conflicts,
    }),
  );
  return { files, edits, steps, layers: applied, conflicts, template_hash: thash, outputs_hash };
}
