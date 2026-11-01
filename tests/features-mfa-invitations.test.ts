import { describe, expect, test } from "vitest";
import { buildOutputs, emptyBase, type BuiltOutput } from "../src/gen/build.js";
import { resolveProjectSpec } from "../src/gen/spec.js";
import { DEFAULT_TEMPLATES_DIR } from "../src/ops/context.js";
import { E2E_SPEC } from "./helpers/e2e.js";

// Plantillas REALES (no fixtures): comprueba qué se genera por app y que, sin feature, no queda rastro.
const build = (apps: Array<Record<string, unknown>>): Promise<BuiltOutput> =>
  buildOutputs(resolveProjectSpec({ ...E2E_SPEC, apps: E2E_SPEC.apps.map((a, i) => ({ ...a, ...(apps[i] ?? {}) })) }), DEFAULT_TEMPLATES_DIR, emptyBase);
const text = (o: BuiltOutput, path: string): string => o.files.find((f) => f.path === path)?.content.toString("utf8") ?? "";
const paths = (o: BuiltOutput): string[] => o.files.map((f) => f.path);

describe("mfa e invitations: plantillas reales", () => {
  test("sin features no queda rastro: ni archivos, ni dependencia, ni permisos, ni paso de composer", async () => {
    const o = await build([{}, {}]);
    expect(o.conflicts).toEqual([]);
    expect(paths(o).filter((p) => /mfa|invit/i.test(p))).toEqual([]);
    expect(text(o, "composer.json")).not.toContain("google2fa");
    expect(text(o, "config/shardevcom.php")).not.toContain("invitations");
    expect(text(o, "app/Http/Controllers/UserAuthController.php")).not.toContain("Mfa");
    expect(text(o, "resources/react/web/src/routes/index.tsx")).toContain("children: [{ path: 'signin'");
    expect(o.steps.some((s) => s.name === "composer-sync-mfa")).toBe(false);
    expect(o.layers.filter((l) => /mfa|invit/.test(l))).toEqual([]);
  });

  test("mfa en una app: servicio, migración, rutas, pruebas, SPA, dependencia y signin propio solo en esa app", async () => {
    const o = await build([{ features: ["mfa"] }, {}]);
    expect(o.conflicts).toEqual([]);
    const mfa = paths(o).filter((p) => /mfa/i.test(p));
    expect(mfa).toEqual(
      expect.arrayContaining([
        "app/Auth/Mfa/UserMfaService.php",
        "app/Auth/Mfa/UserMfaController.php",
        "app/Auth/Mfa/UserMfa.php",
        "app/Auth/Mfa/UserMfaChallenge.php",
        "config/mfa_web.php",
        "database/migrations/2026_01_01_000210_create_users_mfa_table.php",
        "routes/api/web-mfa.php",
        "tests/Feature/UserMfaTest.php",
        "resources/react/web/src/pages/auth/sign-in/mfa-challenge.tsx",
        "resources/react/web/src/pages/profile/mfa-settings.tsx",
      ]),
    );
    expect(mfa.some((p) => /admin|adm\b|admins/i.test(p))).toBe(false);
    expect(JSON.parse(text(o, "composer.json")).require["pragmarx/google2fa"]).toBe("^9.0");
    // el signin de la clase base emite el token sin segundo factor: la app lo sobrescribe
    expect(text(o, "app/Http/Controllers/UserAuthController.php")).toContain("UserMfaService");
    expect(text(o, "app/Http/Controllers/AdminAuthController.php")).not.toContain("Mfa");
    // la tabla de la cuenta no cambia: el opt-in es una fila en <tabla>_mfa
    const mig = text(o, "database/migrations/2026_01_01_000210_create_users_mfa_table.php");
    expect(mig).toContain("constrained('users')->cascadeOnDelete()");
    expect(mig).not.toContain("Schema::table");
    expect(paths(o).filter((p) => p.startsWith("database/migrations/") && p.includes("users")).length).toBe(2); // la de la cuenta + la de mfa
    // el paso que sincroniza composer.lock existe, es pesado y va antes de composer-install
    const names = o.steps.map((s) => s.name);
    expect(names.indexOf("composer-sync-mfa")).toBeGreaterThanOrEqual(0);
    expect(names.indexOf("composer-sync-mfa")).toBeLessThan(names.indexOf("composer-install"));
    expect(o.steps.find((s) => s.name === "composer-sync-mfa")?.full).toBe(true);
  });

  test("cada ruta de mfa lleva throttle propio con el tercer parámetro (la key va en el nombre)", async () => {
    const routes = text(await build([{ features: ["mfa"] }, {}]), "routes/api/web-mfa.php");
    const throttles = [...routes.matchAll(/throttle:(\d+),(\d+),([a-z0-9-]+)/g)];
    expect(throttles.length).toBe((routes.match(/Route::(get|post)\(/g) ?? []).length);
    expect(new Set(throttles.map((m) => m[3])).size).toBe(throttles.length);
    for (const m of throttles) expect(m[3]).toMatch(/-web$/);
  });

  test("invitations: permiso por app con guard, solo en el bloque de esa app; sin registro público", async () => {
    const o = await build([{ features: ["invitations"] }, {}]);
    expect(o.conflicts).toEqual([]);
    const cfg = text(o, "config/shardevcom.php");
    expect(cfg.match(/'invitations' =>/g)?.length).toBe(1);
    const perms = cfg.slice(cfg.indexOf("'permissions' => ["));
    const webBlock = perms.slice(perms.indexOf("'web' => ["), perms.indexOf("'adm' => ["));
    expect(webBlock).toContain("'invitations' => ['admin' => ['list', 'create', 'remove']]");
    const svc = text(o, "app/Auth/Invitations/UserInvitationService.php");
    expect(svc).toContain("private const GUARD = 'web';");
    expect(svc).toContain("checkPermissionTo");
    expect(svc).toContain("hash('sha256'");
    expect(text(o, "routes/api/web-invitations.php")).toContain("throttle:10,1,invitation-accept-web");
    expect(paths(o).some((p) => /register|signup/i.test(p))).toBe(false);
    expect(paths(o)).toContain("app/Console/Commands/UserInviteCommand.php");
    expect(text(o, "app/Console/Commands/UserInviteCommand.php")).toContain("web:invite");
  });

  test("invitations con otp: la aceptación no pide contraseña; sin otp la exige validada", async () => {
    const withOtp = await build([{ features: ["invitations", "otp"] }, {}]);
    expect(text(withOtp, "app/Auth/Invitations/UserAcceptInvitationRequest.php")).not.toContain("password");
    expect(text(withOtp, "app/Auth/Invitations/UserInvitationService.php")).toContain("Str::random(64)");
    const plain = await build([{ features: ["invitations"] }, {}]);
    expect(text(plain, "app/Auth/Invitations/UserAcceptInvitationRequest.php")).toContain("Password::min(10)");
    expect(text(plain, "app/Auth/Invitations/UserInvitationService.php")).not.toContain("Str::random(64)");
  });

  test("ningún archivo generado deja llaves de plantilla sin resolver ni usa $guarded = []", async () => {
    const o = await build([{ features: ["mfa", "invitations"] }, { features: ["invitations", "otp"] }]);
    for (const f of o.files) {
      if (f.path.endsWith(".blade.php")) continue; // Blade usa {{ }} de verdad (las plantillas los escapan)
      const t = f.content.toString("utf8");
      if (!/^(app|config|routes|database|tests|resources)\//.test(f.path)) continue;
      expect(t, f.path).not.toMatch(/\{\{\s*(app|project)\./);
      expect(t, f.path).not.toMatch(/\$guarded\s*=\s*\[\s*\]/);
    }
  });

  test("las dos apps con las mismas features no comparten archivos, tablas ni claves", async () => {
    const o = await build([{ features: ["mfa", "invitations"] }, { features: ["mfa", "invitations"] }]);
    expect(o.conflicts).toEqual([]);
    const created = paths(o);
    expect(new Set(created).size).toBe(created.length);
    for (const p of created.filter((x) => /Mfa|Invitation|-mfa|-invitations|mfa_|invitations_/.test(x))) expect(p).toMatch(/User|Admin|web|adm|users|admins/);
    expect(text(o, "database/migrations/2026_01_01_000210_create_admins_mfa_table.php")).toContain("'admins_mfa'");
    expect(text(o, "database/migrations/2026_01_01_000220_create_users_invitations_table.php")).toContain("'users_invitations'");
  });
});
