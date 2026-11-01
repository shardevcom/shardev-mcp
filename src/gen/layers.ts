import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { ShardevError } from "../core/errors.js";
import { safeRel } from "./safe-path.js";

const LAYER_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const VAR_PATH = z.string().regex(/^[A-Za-z_][A-Za-z0-9_.]*$/);

const FileEntry = z
  .object({
    /** Archivo relativo a la carpeta de la capa (excluyente con `tree`). */
    src: z.string().min(1).optional(),
    /** Carpeta relativa a la capa que se copia entera; `dest` es entonces el directorio destino. */
    tree: z.string().min(1).optional(),
    /** Destino relativo al proyecto; admite {{ vars }}. */
    dest: z.string().min(1),
    /** Copiar sin renderizar (binarios, o texto con llaves dobles literales). En `tree` es true por defecto. */
    raw: z.boolean().optional(),
    /** Solo con `tree`: sufijos o rutas relativas exactas que SÍ se renderizan (el resto se copia tal cual). */
    render: z.array(z.string().min(1)).default([]),
    mode: z.string().regex(/^0[0-7]{3}$/).optional(),
  })
  .strict()
  .refine((f) => (f.src === undefined) !== (f.tree === undefined), { message: "exactamente uno de src o tree" })
  .refine((f) => f.tree === undefined || f.raw === undefined, { message: "raw no aplica a tree (usa render)" })
  .refine((f) => f.tree !== undefined || f.render.length === 0, { message: "render solo aplica a tree" });

const EditBase = { file: z.string().min(1) };
const EditSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("json-merge"),
      ...EditBase,
      value: z.record(z.string(), z.unknown()),
      /**
       * Un merge ya aplicado NO es un conflicto en `app_create` (que normalmente rechaza un edit que no cambia nada:
       * suele ser un cambio manual). Para dependencias compartidas por varias apps (la 2ª app con la feature ya
       * encuentra la dependencia). Un valor distinto sigue siendo conflicto.
       */
      idempotent: z.boolean().default(false),
    })
    .strict(),
  z.object({ type: z.literal("yaml-append"), ...EditBase, path: z.array(z.string().min(1)).min(1), value: z.unknown() }).strict(),
  z
    .object({
      type: z.literal("insert"),
      ...EditBase,
      anchor: z.string().min(1),
      position: z.enum(["before", "after"]),
      content: z.string(),
      indent: z.boolean().default(true),
    })
    .strict(),
]);
export type EditDef = z.infer<typeof EditSchema>;

const VerifyStepSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,40}$/),
    argv: z.array(z.string().min(1)).min(1),
    timeout_s: z.number().int().min(1).max(1800).default(120),
    /** true = paso pesado (composer/pnpm/build): lo corre project_verify, no project_create. */
    full: z.boolean().default(false),
    /** Adiciones explícitas al entorno del paso (COMPOSER_HOME, LANG...). */
    env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string()).default({}),
  })
  .strict();
export type VerifyStepDef = z.infer<typeof VerifyStepSchema>;

export const LayerSchema = z
  .object({
    name: z.string().regex(LAYER_NAME),
    scope: z.enum(["project", "app", "mobile"]),
    order: z.number().int().min(0).max(10_000).default(100),
    /** Condición (`app.feature.mfa`, `!app.feature.social`) para aplicar la capa. */
    when: z.string().optional(),
    /** Variables que la capa DEBE usar en alguna de sus plantillas/edits. */
    requires: z.array(VAR_PATH).default([]),
    files: z.array(FileEntry).default([]),
    edits: z.array(EditSchema).default([]),
    verify: z.array(VerifyStepSchema).default([]),
  })
  .strict();
export type LayerDef = z.infer<typeof LayerSchema>;

export interface Layer extends LayerDef {
  dir: string;
}

export async function loadLayers(templatesDir: string): Promise<Layer[]> {
  let entries: string[];
  try {
    entries = await readdir(templatesDir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const layers: Layer[] = [];
  for (const name of entries.sort()) {
    const dir = join(templatesDir, name);
    const st = await lstat(dir);
    if (!st.isDirectory()) continue;
    let text: string;
    try {
      text = await readFile(join(dir, "layer.yaml"), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue; // carpeta sin layer.yaml no es capa
      throw e;
    }
    let raw: unknown;
    try {
      raw = parse(text);
    } catch (e) {
      throw new ShardevError("invalid_layer", `${name}/layer.yaml no es YAML válido: ${(e as Error).message.split("\n")[0]}`);
    }
    const r = LayerSchema.safeParse(raw);
    if (!r.success) {
      throw new ShardevError("invalid_layer", `${name}/layer.yaml inválido: ${r.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ")}`);
    }
    if (r.data.name !== name) throw new ShardevError("invalid_layer", `${name}/layer.yaml declara name "${r.data.name}"`);
    for (const f of r.data.files) {
      safeRel((f.src ?? f.tree)!, `${name}: src`);
      const dest = f.dest.replaceAll(/\{\{[^}]*\}\}/g, "x"); // validación de forma; el destino real se valida tras renderizar
      if (!(f.tree !== undefined && dest === ".")) safeRel(dest, `${name}: dest`); // "." = raíz del proyecto (solo tree)
    }
    for (const e of r.data.edits) {
      safeRel(e.file.replaceAll(/\{\{[^}]*\}\}/g, "x"), `${name}: edit.file`);
    }
    layers.push({ ...r.data, dir });
  }
  return layers.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export async function walk(dir: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const name of (await readdir(join(dir, rel))).sort()) {
    const r = rel ? `${rel}/${name}` : name;
    const st = await lstat(join(dir, r));
    if (st.isSymbolicLink()) throw new ShardevError("invalid_layer", `Symlink en plantillas: ${r}`);
    if (st.isDirectory()) out.push(...(await walk(dir, r)));
    else out.push(r);
  }
  return out;
}

/** Hash de versión de TODAS las plantillas (rutas + contenido). Cambia si algo cambia. */
export async function templateHash(templatesDir: string): Promise<string> {
  const h = createHash("sha256");
  let files: string[];
  try {
    files = await walk(templatesDir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return h.update("empty").digest("hex");
    throw e;
  }
  for (const f of files) {
    h.update(f).update("\0").update(await readFile(join(templatesDir, f))).update("\0");
  }
  return h.digest("hex");
}

export async function readLayerFile(layer: Layer, src: string): Promise<Buffer> {
  const full = join(layer.dir, safeRel(src, "src"));
  const st = await lstat(full).catch(() => null);
  if (!st || !st.isFile()) throw new ShardevError("invalid_layer", `${layer.name}: no existe el archivo de plantilla ${src}`);
  return readFile(full);
}
