import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { ShardevError } from "./errors.js";
import { projectsFile, type Paths } from "./paths.js";

export const MODES = ["disabled", "command-only", "gated-apply"] as const;
export type Mode = (typeof MODES)[number];
export const ModeSchema = z.enum(MODES);

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const EnvironmentSchema = z
  .object({
    name: z.string().regex(NAME_RE),
    /** Obligatorio, sin default: una omisión no puede convertir producción en no-producción. */
    is_production: z.boolean(),
    aws_profile: z.string().min(1),
    account_id: z.string().regex(/^\d{12}$/, "account_id debe tener 12 dígitos"),
    region: z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d$/),
    cluster: z.string().min(1),
  })
  .strict();
export type Environment = z.infer<typeof EnvironmentSchema>;

export const OpsManifestSchema = z
  .object({
    project: z.object({ name: z.string().regex(NAME_RE) }).strict(),
    stack: z.string().min(1),
    /** Prefijo obligatorio de todo servicio ECS (el cluster se comparte entre proyectos). */
    service_prefix: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    capabilities: z.array(z.string().min(1)).default([]),
    /** El proyecto solo puede restringir: este tope se combina con la policy del usuario. */
    policy: z.object({ max_mode: ModeSchema }).strict().optional(),
    environments: z.array(EnvironmentSchema).min(1),
  })
  .strict()
  .superRefine((m, ctx) => {
    const seen = new Set<string>();
    m.environments.forEach((e, i) => {
      if (seen.has(e.name)) ctx.addIssue({ code: "custom", message: `Entorno duplicado: ${e.name}`, path: ["environments", i, "name"] });
      seen.add(e.name);
    });
  });
export type OpsManifest = z.infer<typeof OpsManifestSchema>;

export const ProjectsRegistrySchema = z
  .object({
    projects: z.record(z.string().regex(NAME_RE), z
        .object({
          path: z.string().min(1),
          /** Entornos que el dueño declara como producción, sin importar lo que diga el ops.yaml del proyecto. */
          production_envs: z.array(z.string().regex(NAME_RE)).default([]),
        })
        .strict()),
  })
  .strict();
export type ProjectsRegistry = z.infer<typeof ProjectsRegistrySchema>;

function formatIssues(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ");
}

export function parseManifest(text: string): OpsManifest {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (e) {
    throw new ShardevError("invalid_manifest", `ops.yaml no es YAML válido: ${(e as Error).message.split("\n")[0]}`);
  }
  const r = OpsManifestSchema.safeParse(raw);
  if (!r.success) throw new ShardevError("invalid_manifest", `ops.yaml inválido: ${formatIssues(r.error)}`);
  return r.data;
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/** Registro de proyectos. Si no existe el archivo, el registro está vacío. */
export async function loadRegistry(paths: Paths): Promise<ProjectsRegistry> {
  const text = await readIfExists(projectsFile(paths));
  if (text === null) return { projects: {} };
  let raw: unknown;
  try {
    raw = parse(text) ?? { projects: {} };
  } catch (e) {
    throw new ShardevError("invalid_manifest", `projects.yaml no es YAML válido: ${(e as Error).message.split("\n")[0]}`);
  }
  const r = ProjectsRegistrySchema.safeParse(raw);
  if (!r.success) throw new ShardevError("invalid_manifest", `projects.yaml inválido: ${formatIssues(r.error)}`);
  return r.data;
}

export interface ResolvedProject {
  name: string;
  path: string;
  manifest: OpsManifest;
  /** `production_envs` del proyecto en projects.yaml (config del dueño). */
  productionEnvs: string[];
}

/** Las herramientas reciben el NOMBRE de un proyecto registrado, nunca una ruta libre. */
export async function resolveProject(paths: Paths, name: string): Promise<ResolvedProject> {
  const registry = await loadRegistry(paths);
  const entry = Object.hasOwn(registry.projects, name) ? registry.projects[name] : undefined;
  if (!entry) {
    throw new ShardevError("unregistered_project", `El proyecto "${name}" no está registrado en projects.yaml.`);
  }
  if (!isAbsolute(entry.path)) {
    throw new ShardevError("invalid_manifest", `La ruta del proyecto "${name}" debe ser absoluta.`);
  }
  const text = await readIfExists(join(entry.path, "ops.yaml"));
  if (text === null) throw new ShardevError("invalid_manifest", `No se encontró ops.yaml en el proyecto "${name}".`);
  const manifest = parseManifest(text);
  if (manifest.project.name !== name) {
    throw new ShardevError("invalid_manifest", `ops.yaml declara el proyecto "${manifest.project.name}", pero está registrado como "${name}".`);
  }
  return { name, path: entry.path, manifest, productionEnvs: entry.production_envs };
}

/** `env` es obligatorio en todas partes: nunca hay entorno por defecto. */
export function requireEnvironment(manifest: OpsManifest, env: string | undefined): Environment {
  if (env === undefined || env === "") {
    const names = manifest.environments.map((e) => e.name).join(", ");
    throw new ShardevError("env_required", `Debes indicar el entorno explícitamente (no hay default). Opciones: ${names}.`);
  }
  const found = manifest.environments.find((e) => e.name === env);
  if (!found) {
    throw new ShardevError("unknown_environment", `El entorno "${env}" no existe en ops.yaml de ${manifest.project.name}.`);
  }
  return found;
}

/** Rechaza cualquier servicio ECS que no empiece por el prefijo del proyecto. */
export function assertServiceName(manifest: OpsManifest, service: string): void {
  const prefix = manifest.service_prefix;
  if (typeof service !== "string" || !service.startsWith(prefix) || service.length === prefix.length) {
    throw new ShardevError(
      "foreign_service",
      `El servicio "${String(service).slice(0, 80)}" no pertenece al proyecto ${manifest.project.name} (prefijo requerido: "${prefix}").`,
    );
  }
}
