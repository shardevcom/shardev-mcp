import { z } from "zod";
import { ShardevError } from "../core/errors.js";

/** Nombres seguros: sin separadores de ruta, sin `..`, sin mayúsculas ni espacios. */
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** key de app: minúsculas y dígitos, empieza por letra (se usa para derivar clases y tablas). */
const KEY_RE = /^[a-z][a-z0-9]{0,30}$/;
const IDENT_RE = /^[a-z][a-z0-9_]{0,62}$/;
const MODEL_RE = /^[A-Z][A-Za-z0-9]{0,62}$/;
const BUILD_DIR_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const APP_ID_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const APP_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,59}$/u;

/** Nombres de feature conocidos. Que exista una capa (`when: app.feature.<x>`) es otra cosa: ver `assertFeatureLayers`. */
export const APP_FEATURES = ["mfa", "invitations", "otp", "social"] as const;
/** Solo los proveedores para los que `integrations` trae un verificador de id_token. */
export const SOCIAL_PROVIDERS = ["google", "microsoft", "apple"] as const;
export const PLATFORMS = ["android", "ios"] as const;

export const AppSpecInputSchema = z
  .object({
    key: z.string().regex(KEY_RE, "key: minúsculas y dígitos, empieza por letra (sin separadores de ruta)"),
    user_type: z.enum(["new", "existing"]),
    provider: z.string().regex(IDENT_RE).optional(),
    table: z.string().regex(IDENT_RE).optional(),
    model: z.string().regex(MODEL_RE).optional(),
    api_guard: z.string().regex(IDENT_RE).optional(),
    session_guard: z.string().regex(IDENT_RE).optional(),
    port: z.number().int().min(1024).max(65535),
    build_dir: z.string().regex(BUILD_DIR_RE).optional(),
    features: z.array(z.enum(APP_FEATURES)).default([]),
    social_providers: z.array(z.enum(SOCIAL_PROVIDERS)).default([]),
    /** Crear la cuenta en el primer login válido (OTP o social). Por defecto NO: una cuenta inexistente nunca entra. */
    auto_register: z.boolean().default(false),
  })
  .strict();
export type AppSpecInput = z.input<typeof AppSpecInputSchema>;

export const MobileSpecSchema = z
  .object({
    app: z.string().regex(KEY_RE),
    app_id: z.string().regex(APP_ID_RE, "app_id: formato com.empresa.app"),
    app_name: z.string().regex(APP_NAME_RE, "app_name: letras, números, espacios, . _ -"),
    platforms: z.array(z.enum(PLATFORMS)).min(1).default(["android"]),
  })
  .strict();
export type MobileSpec = z.infer<typeof MobileSpecSchema>;

export const ProjectSpecInputSchema = z
  .object({
    name: z.string().regex(NAME_RE, "name: minúsculas, dígitos y guiones"),
    domain: z.string().regex(DOMAIN_RE, "domain: nombre de dominio en minúsculas"),
    apps: z.array(AppSpecInputSchema).min(1).max(16),
    features: z.array(z.string().regex(IDENT_RE)).default([]),
    mobile: MobileSpecSchema.optional(),
  })
  .strict();
export type ProjectSpecInput = z.input<typeof ProjectSpecInputSchema>;

export interface AppSpec {
  key: string;
  user_type: "new" | "existing";
  provider: string;
  table: string;
  model: string;
  api_guard: string;
  session_guard: string;
  port: number;
  build_dir: string;
  features: Array<(typeof APP_FEATURES)[number]>;
  social_providers: Array<(typeof SOCIAL_PROVIDERS)[number]>;
  auto_register: boolean;
}
export interface ProjectSpec {
  name: string;
  domain: string;
  apps: AppSpec[];
  features: string[];
  mobile?: MobileSpec;
}

const pascal = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Nombres derivados de `key`; todo es sobrescribible. */
export function deriveApp(a: z.output<typeof AppSpecInputSchema>): AppSpec {
  return {
    key: a.key,
    user_type: a.user_type,
    provider: a.provider ?? `${a.key}s`,
    table: a.table ?? `${a.key}s`,
    model: a.model ?? pascal(a.key),
    api_guard: a.api_guard ?? a.key,
    session_guard: a.session_guard ?? `${a.key}_session`,
    port: a.port,
    build_dir: a.build_dir ?? `build-${a.key}`,
    features: [...new Set(a.features)],
    social_providers: [...new Set(a.social_providers)],
    auto_register: a.auto_register,
  };
}

function findDuplicates(label: string, values: Array<{ owner: string; value: string | number }>, issues: string[]): void {
  const seen = new Map<string | number, string>();
  for (const { owner, value } of values) {
    const prev = seen.get(value);
    if (prev !== undefined) issues.push(`${label} duplicado "${String(value)}" (apps ${prev} y ${owner})`);
    else seen.set(value, owner);
  }
}

/** Valida y completa el spec. Lanza ShardevError("invalid_spec") con todos los problemas. */
export function resolveProjectSpec(input: unknown): ProjectSpec {
  const r = ProjectSpecInputSchema.safeParse(input);
  if (!r.success) {
    throw new ShardevError("invalid_spec", `Spec inválido: ${r.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ")}`);
  }
  const apps = r.data.apps.map(deriveApp);
  const issues: string[] = [];

  findDuplicates("key", apps.map((a) => ({ owner: a.key, value: a.key })), issues);
  // Un solo espacio de nombres para guards: api y sesión de todas las apps.
  findDuplicates("guard", apps.flatMap((a) => [{ owner: a.key, value: a.api_guard }, { owner: a.key, value: a.session_guard }]), issues);
  findDuplicates("tabla", apps.map((a) => ({ owner: a.key, value: a.table })), issues);
  findDuplicates("provider", apps.map((a) => ({ owner: a.key, value: a.provider })), issues);
  findDuplicates("modelo", apps.map((a) => ({ owner: a.key, value: a.model })), issues);
  findDuplicates("puerto", apps.map((a) => ({ owner: a.key, value: a.port })), issues);
  findDuplicates("build_dir", apps.map((a) => ({ owner: a.key, value: a.build_dir })), issues);

  for (const a of apps) {
    const social = a.features.includes("social");
    if (social && a.social_providers.length === 0) issues.push(`app ${a.key}: la feature social requiere social_providers`);
    if (!social && a.social_providers.length > 0) issues.push(`app ${a.key}: social_providers sin la feature social`);
    if (a.auto_register && !social && !a.features.includes("otp")) issues.push(`app ${a.key}: auto_register solo tiene sentido con la feature otp o social`);
  }
  const mobile = r.data.mobile;
  if (mobile && !apps.some((a) => a.key === mobile.app)) issues.push(`mobile.app "${mobile.app}" no es una app declarada`);
  if (issues.length > 0) throw new ShardevError("invalid_spec", `Spec inválido: ${issues.join("; ")}`);

  return {
    name: r.data.name,
    domain: r.data.domain,
    apps,
    features: [...new Set(r.data.features)],
    ...(mobile ? { mobile: { ...mobile, platforms: [...new Set(mobile.platforms)] } } : {}),
  };
}
