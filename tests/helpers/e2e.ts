import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exec, type Runner } from "../../src/core/exec.js";
import { createContext, type Ctx } from "../../src/ops/context.js";

/** Spec del proyecto de pruebas: web (usuarios) + adm (administradores). */
export const E2E_SPEC = {
  name: "acme",
  domain: "acme.example.com",
  apps: [
    { key: "web", user_type: "new", provider: "users", table: "users", model: "User", session_guard: "website", port: 5173 },
    { key: "adm", user_type: "new", provider: "admins", table: "admins", model: "Admin", session_guard: "admin", port: 5174 },
  ],
};

export interface E2eEnv {
  ctx: Ctx;
  root: string;
  home: string;
  projectsFile: string;
}

/**
 * Contexto aislado: config y estado en un temporal (nunca el ~/.config real), y un HOME temporal
 * para los pasos (composer/pnpm/docker escriben sus cachés ahí, no en el HOME real).
 */
export async function e2eEnv(): Promise<E2eEnv> {
  const base = await mkdtemp(join(tmpdir(), "shardev-e2e-"));
  const paths = { configDir: join(base, "config"), stateDir: join(base, "state") };
  const root = join(base, "projects");
  const home = join(base, "home");
  await Promise.all([mkdir(paths.configDir, { recursive: true }), mkdir(root, { recursive: true }), mkdir(home, { recursive: true })]);
  await writeFile(join(paths.configDir, "config.yaml"), `allowed_roots:\n  - ${root}\n`);
  const runner: Runner = (cmd, args, opts = {}) => exec(cmd, args, { ...opts, inheritFrom: { PATH: process.env.PATH ?? "", HOME: home } });
  return { ctx: createContext(paths, { runner }), root, home, projectsFile: join(paths.configDir, "projects.yaml") };
}
