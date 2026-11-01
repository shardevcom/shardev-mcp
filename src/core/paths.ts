import { homedir } from "node:os";
import { join } from "node:path";

export interface Paths {
  /** Config del dueño (policy.yaml, projects.yaml). Ninguna herramienta escribe aquí. */
  configDir: string;
  /** Estado (logs, auditoría). */
  stateDir: string;
}

/**
 * Rutas reales. Deliberadamente SIN override por variable de entorno: un `.mcp.json`
 * de proyecto podría apuntar a una policy permisiva. Los tests pasan `Paths` explícitos.
 */
export function defaultPaths(home: string = homedir()): Paths {
  return {
    configDir: join(home, ".config", "shardev-mcp"),
    stateDir: join(home, ".local", "state", "shardev-mcp"),
  };
}

export const policyFile = (p: Paths): string => join(p.configDir, "policy.yaml");
export const projectsFile = (p: Paths): string => join(p.configDir, "projects.yaml");
export const logsDir = (p: Paths): string => join(p.stateDir, "logs");
export const auditFile = (p: Paths): string => join(p.stateDir, "audit.jsonl");
export const configFile = (p: Paths): string => join(p.configDir, "config.yaml");
export const plansDir = (p: Paths): string => join(p.stateDir, "plans");
export const planKeyFile = (p: Paths): string => join(p.stateDir, "plan.key");
