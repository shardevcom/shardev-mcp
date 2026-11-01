import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { ShardevError } from "./errors.js";
import { configFile, type Paths } from "./paths.js";

export const ConfigSchema = z
  .object({
    /** Raíces bajo las que `project_create` puede crear proyectos. Sin esto, no se crea nada. */
    allowed_roots: z.array(z.string().refine((p) => isAbsolute(p) && !p.includes("\0"), "debe ser una ruta absoluta")).default([]),
    /**
     * Términos (nombres de proyectos o dominios de origen) que no deben aparecer en un proyecto generado:
     * coincidencia literal, sin distinguir mayúsculas. Un término contenido en el nombre/dominio del propio proyecto no cuenta.
     */
    leftover_terms: z.array(z.string().trim().min(2, "mínimo 2 caracteres").max(100).refine((t) => !t.includes("\0"), "carácter inválido")).default([]),
  })
  .strict();
export type Config = z.infer<typeof ConfigSchema>;

/** ~/.config/shardev-mcp/config.yaml (del dueño; ninguna herramienta lo escribe). Ausente = sin raíces permitidas. */
export async function loadConfig(paths: Paths): Promise<Config> {
  let text: string;
  try {
    text = await readFile(configFile(paths), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { allowed_roots: [], leftover_terms: [] };
    throw e;
  }
  let raw: unknown;
  try {
    raw = parse(text) ?? {};
  } catch (e) {
    throw new ShardevError("invalid_config", `config.yaml no es YAML válido: ${(e as Error).message.split("\n")[0]}`);
  }
  const r = ConfigSchema.safeParse(raw);
  if (!r.success) throw new ShardevError("invalid_config", `config.yaml inválido: ${r.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ")}`);
  return r.data;
}
