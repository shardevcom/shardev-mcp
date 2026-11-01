import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createContext, type Ctx } from "../../src/ops/context.js";
import type { Paths } from "../../src/core/paths.js";
import { tempDir, tempPaths } from "./fixtures.js";

export async function put(root: string, rel: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, rel)), { recursive: true });
  await writeFile(join(root, rel), text);
}

export const SPEC = {
  name: "acme",
  domain: "acme.example.com",
  features: ["rewards"],
  apps: [
    { key: "web", user_type: "existing", port: 5173, features: ["mfa"] },
    { key: "adm", user_type: "new", port: 5174 },
  ],
};

export interface FixtureOptions {
  /** Paso de verificación extra de la capa base (por defecto pasa). */
  failingStep?: boolean;
  /** Contenido extra en README (p. ej. un secreto). */
  readmeExtra?: string;
  /** Si es false, la capa base no crea archivos (para repos existentes). */
  base?: boolean;
}

/** Capas de fixture pequeñas: base (proyecto), app (por app), mfa (condicional). */
export async function writeTemplates(dir: string, o: FixtureOptions = {}): Promise<void> {
  if (o.base !== false) {
    await put(dir, "base/layer.yaml", `name: base
scope: project
order: 10
requires: [project.name, project.domain]
files:
  - { src: files/README.md, dest: README.md }
  - { src: files/package.json, dest: package.json }
  - { src: files/pnpm-workspace.yaml, dest: pnpm-workspace.yaml }
  - { src: files/auth.php, dest: config/auth.php }
  - { src: files/web.php, dest: routes/web.php }
  - { src: files/nginx.conf, dest: docker/nginx.conf }
  - { src: files/run.sh, dest: bin/run.sh, mode: "0755" }
verify:
  - name: readme-present
    argv: [node, -e, "require('fs').accessSync('README.md')"]
    timeout_s: 20
    env: { LANG: C.UTF-8 }
${o.failingStep ? "  - { name: always-fails, argv: [node, -e, 'process.exit(3)'], timeout_s: 20 }\n" : ""}`);
    await put(dir, "base/files/README.md", `# {{ project.name }}\n\nDominio: {{ project.domain }}\n{{#if project.feature.rewards}}\nRewards activado.\n{{/if}}\n${o.readmeExtra ?? ""}`);
    await put(dir, "base/files/package.json", `{\n  "name": "{{ project.name }}",\n  "private": true,\n  "scripts": {}\n}\n`);
    await put(dir, "base/files/pnpm-workspace.yaml", `# workspaces\npackages:\n  - "packages/*"\n`);
    await put(dir, "base/files/auth.php", `<?php\nreturn [\n    'guards' => [\n        // shardev:guards\n    ],\n];\n`);
    await put(dir, "base/files/web.php", `<?php\n// shardev:routes\n`);
    await put(dir, "base/files/nginx.conf", `server {\n  server_name {{ project.domain }};\n  location / { proxy_set_header Host $host; proxy_pass http://\${UPSTREAM}:80; }\n  # $VAR y \${VAR} quedan igual\n}\n`);
    await put(dir, "base/files/run.sh", `#!/bin/sh\necho "$HOME \${APP_ENV:-x}"\n`);
  }
  await put(dir, "app/layer.yaml", `name: app
scope: app
order: 20
requires: [app.key, app.api_guard, app.port]
files:
  - { src: files/app.json, dest: "apps/{{ app.key }}/app.json" }
edits:
  - type: json-merge
    file: package.json
    value:
      scripts:
        "dev:{{ app.key }}": "vite --port {{ app.port }}"
  - type: yaml-append
    file: pnpm-workspace.yaml
    path: [packages]
    value: "apps/{{ app.key }}"
  - type: insert
    file: config/auth.php
    anchor: "// shardev:guards"
    position: before
    content: |
      '{{ app.api_guard }}' => ['driver' => 'passport', 'provider' => '{{ app.provider }}'],
  - type: insert
    file: routes/web.php
    anchor: "// shardev:routes"
    position: after
    content: "Route::view('/{{ app.key }}', '{{ app.key }}');"
`);
  await put(dir, "app/files/app.json", `{ "key": "{{ app.key }}", "port": {{ app.port }}, "guard": "{{ app.session_guard }}" }\n`);
  await put(dir, "mfa/layer.yaml", `name: mfa
scope: app
order: 30
when: app.feature.mfa
requires: [app.key]
files:
  - { src: files/mfa.txt, dest: "apps/{{ app.key }}/mfa.txt" }
`);
  await put(dir, "mfa/files/mfa.txt", `mfa for {{ app.key }}\n`);
}

export interface Env {
  paths: Paths;
  templates: string;
  root: string;
  ctx: Ctx;
  clock: { t: number };
}

/** Entorno aislado: HOME falso (paths), plantillas de fixture, raíz permitida y reloj controlable. */
export async function setup(o: FixtureOptions = {}): Promise<Env> {
  const paths = await tempPaths();
  const templates = await tempDir();
  const root = await tempDir();
  await writeTemplates(templates, o);
  await writeFile(join(paths.configDir, "config.yaml"), `allowed_roots:\n  - ${root}\n`);
  const clock = { t: Date.parse("2026-11-01T12:00:00Z") };
  const ctx = createContext(paths, { templatesDir: templates, now: () => new Date(clock.t) });
  return { paths, templates, root, ctx, clock };
}

export const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** Repo existente en `develop` con los archivos que las capas de app editan. */
export async function makeRepo(root: string, name = "repo", branch = "develop"): Promise<string> {
  const repo = join(root, name);
  await mkdir(repo, { recursive: true });
  git(repo, "init", "-q", "-b", branch);
  await put(repo, "package.json", `{\n  "name": "acme",\n  "scripts": {}\n}\n`);
  await put(repo, "pnpm-workspace.yaml", `packages:\n  - "packages/*"\n`);
  await put(repo, "config/auth.php", `<?php\nreturn [\n    'guards' => [\n        // shardev:guards\n    ],\n];\n`);
  await put(repo, "routes/web.php", `<?php\n// shardev:routes\n`);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  return repo;
}
