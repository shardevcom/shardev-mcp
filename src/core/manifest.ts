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
/** Nombre de servicio ECS: letras, dígitos, guiones y guiones bajos (máx. 255). */
const ECS_SERVICE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,254}$/;

/** Prefijo de grupo de logs de CloudWatch: solo los caracteres válidos de un nombre de grupo (sin espacios ni control), sin `..`. */
const LOG_GROUP_PREFIX_RE = /^[A-Za-z0-9_./#-]{1,200}$/;
export const DEFAULT_LOG_GROUP_PREFIX = "/ecs/";

export const EnvironmentSchema = z
  .object({
    name: z.string().regex(NAME_RE),
    /** Obligatorio, sin default: una omisión no puede convertir producción en no-producción. */
    is_production: z.boolean(),
    aws_profile: z.string().min(1),
    account_id: z.string().regex(/^\d{12}$/, "account_id debe tener 12 dígitos"),
    region: z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d$/),
    cluster: z.string().min(1),
    /**
     * Servicios ECS de ESTE entorno, nombre exacto. Opcional para no romper manifests existentes, pero las
     * herramientas de lectura ECS/logs fallan cerradas sin él: con cluster y cuenta compartidos, un
     * `service_prefix` solo no separa entornos (el prefijo de producción también cubre los de staging).
     */
    services: z.array(z.string().regex(ECS_SERVICE_RE, "nombre de servicio ECS inválido")).min(1).optional(),
    /** Prefijo del grupo de logs; el grupo es `<log_group_prefix><servicio>`. Por defecto `/ecs/`. */
    log_group_prefix: z
      .string()
      .regex(LOG_GROUP_PREFIX_RE, "log_group_prefix inválido: use letras, dígitos y _ . / # - (1-200 caracteres)")
      .refine((v) => !v.includes(".."), "log_group_prefix no puede contener '..'")
      .optional(),
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
      e.services?.forEach((svc, j) => {
        if (!svc.startsWith(m.service_prefix) || svc.length === m.service_prefix.length) {
          ctx.addIssue({ code: "custom", message: `El servicio "${svc}" no empieza por service_prefix ("${m.service_prefix}")`, path: ["environments", i, "services", j] });
        }
        if (e.services!.indexOf(svc) !== j) ctx.addIssue({ code: "custom", message: `Servicio duplicado: ${svc}`, path: ["environments", i, "services", j] });
      });
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
          /** Raíz del árbol de código (donde viven `.aws/env/` y `env.schema`) si no es `path`. Absoluta; por defecto `path`. */
          root: z.string().min(1).optional(),
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
  /** Raíz del árbol de código: `root` de projects.yaml o, si falta, `path`. */
  root: string;
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
  if (entry.root !== undefined && !isAbsolute(entry.root)) {
    throw new ShardevError("invalid_manifest", `El \`root\` del proyecto "${name}" debe ser una ruta absoluta.`);
  }
  const text = await readIfExists(join(entry.path, "ops.yaml"));
  if (text === null) throw new ShardevError("invalid_manifest", `No se encontró ops.yaml en el proyecto "${name}".`);
  const manifest = parseManifest(text);
  if (manifest.project.name !== name) {
    throw new ShardevError("invalid_manifest", `ops.yaml declara el proyecto "${manifest.project.name}", pero está registrado como "${name}".`);
  }
  return { name, path: entry.path, root: entry.root ?? entry.path, manifest, productionEnvs: entry.production_envs };
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

/** Servicios que el entorno declara. Falla cerrado si no hay `services` (no se descubre nada con list-services). */
export function declaredServices(manifest: OpsManifest, env: Environment): string[] {
  if (!env.services || env.services.length === 0) {
    throw new ShardevError(
      "services_not_declared",
      `El entorno "${env.name}" de ${manifest.project.name} no declara \`services\` en ops.yaml: añade, bajo ese entorno, la lista exacta de servicios ECS (p. ej. services: [${manifest.service_prefix}app]).`,
    );
  }
  return [...env.services];
}

/**
 * Un servicio es válido para un entorno solo si empieza por `service_prefix` Y está listado
 * exactamente en `services` de ESE entorno. El prefijo solo no basta (cluster y cuenta compartidos).
 */
export function assertServiceName(manifest: OpsManifest, env: Environment, service: string): void {
  const prefix = manifest.service_prefix;
  if (typeof service !== "string" || !service.startsWith(prefix) || service.length === prefix.length) {
    throw new ShardevError(
      "foreign_service",
      `El servicio "${String(service).slice(0, 80)}" no pertenece al proyecto ${manifest.project.name} (prefijo requerido: "${prefix}").`,
    );
  }
  if (!declaredServices(manifest, env).includes(service)) {
    throw new ShardevError(
      "foreign_service",
      `El servicio "${service.slice(0, 80)}" no está declarado en \`services\` del entorno "${env.name}" de ${manifest.project.name}.`,
    );
  }
}

/** Una herramienta solo opera si el proyecto declara la capacidad correspondiente. */
export function requireCapability(manifest: OpsManifest, capability: string): void {
  if (!manifest.capabilities.includes(capability)) {
    throw new ShardevError("capability_missing", `El proyecto ${manifest.project.name} no declara la capacidad "${capability}" en \`capabilities\` de ops.yaml.`);
  }
}
