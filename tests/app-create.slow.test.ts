import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { appCreate, appPlan } from "../src/ops/app.js";
import { projectCreate, projectPlan, projectVerify } from "../src/ops/project.js";
import { E2E_SPEC, e2eEnv } from "./helpers/e2e.js";

// LENTA: genera `acme` (web + adm), le añade `supp` (user_type new) y `partner` (user_type existing, con un
// modelo escrito a mano por el dueño) y corre project_verify completo: composer, migraciones, seed, PHP
// (incluido el aislamiento entre guards de TODAS las apps), pnpm, tipos y build. Necesita red, PHP 8.4,
// composer, pnpm y docker (solo `compose config`). Ejecuta: npm run test:slow
const write = async (root: string, rel: string, text: string): Promise<void> => {
  await mkdir(dirname(join(root, rel)), { recursive: true });
  await writeFile(join(root, rel), text);
};

// Modelo, factory y migración del tipo de usuario "partner", como los escribiría el dueño (no los genera shardev).
const PARTNER_MODEL = `<?php

namespace App\\Models;

use Database\\Factories\\PartnerFactory;
use Shardevcom\\Authentications\\Models\\Account;

class Partner extends Account
{
    protected $table = 'partners';

    protected $guard_name = 'partner';

    protected static function newFactory(): PartnerFactory
    {
        return PartnerFactory::new();
    }
}
`;
const PARTNER_FACTORY = `<?php

namespace Database\\Factories;

use App\\Models\\Partner;
use Illuminate\\Database\\Eloquent\\Factories\\Factory;
use Illuminate\\Support\\Facades\\Hash;

/** @extends Factory<Partner> */
class PartnerFactory extends Factory
{
    protected $model = Partner::class;

    protected static ?string $password = null;

    public function definition(): array
    {
        return [
            'name' => fake()->name(),
            'email' => fake()->unique()->safeEmail(),
            'password' => static::$password ??= Hash::make('password-for-tests'),
            'active' => true,
            'remember_token' => str()->random(10),
        ];
    }
}
`;
const PARTNER_MIGRATION = `<?php

use Illuminate\\Database\\Migrations\\Migration;
use Illuminate\\Database\\Schema\\Blueprint;
use Illuminate\\Support\\Facades\\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('partners', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('email')->unique();
            $table->string('phone', 30)->nullable();
            $table->string('avatar_url', 2048)->nullable();
            $table->timestamp('email_verified_at')->nullable();
            $table->string('password');
            $table->boolean('active')->default(true);
            $table->rememberToken();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('partners');
    }
};
`;
// Prueba extra solo de este e2e: las 4 apps existen y los tokens con el MISMO id no cruzan entre supp, partner, web y adm.
const EXTRA_ISOLATION_TEST = `<?php

namespace Tests\\Feature;

use Illuminate\\Foundation\\Testing\\RefreshDatabase;
use Tests\\Feature\\Concerns\\AuthApps;
use Tests\\TestCase;

class AddedAppsIsolationTest extends TestCase
{
    use AuthApps;
    use RefreshDatabase;

    public function test_las_cuatro_apps_estan_declaradas_y_se_aislan_con_el_mismo_id(): void
    {
        $this->setUpAuthApps();
        $this->assertEqualsCanonicalizing(['web', 'adm', 'supp', 'partner'], array_keys($this->apps()));

        $accounts = [];
        foreach (['web', 'adm', 'supp', 'partner'] as $app) {
            $accounts[$app] = $this->makeAccount($app);
        }
        $this->assertCount(1, array_unique(array_map(fn ($a) => $a->getKey(), $accounts)), 'mismo id en las cuatro tablas');

        foreach ($accounts as $own => $account) {
            $headers = $this->bearer($account);
            $this->as($headers)->getJson("/api/{$own}/profile")->assertOk();
            foreach (array_keys($accounts) as $other) {
                if ($other !== $own) {
                    $this->as($headers)->getJson("/api/{$other}/profile")->assertUnauthorized();
                    $this->as($headers)->getJson("/api/{$other}/roles")->assertUnauthorized();
                }
            }
        }
    }
}
`;

describe("app_create (e2e)", () => {
  test("acme (web, adm) + supp (new) + partner (existing) -> project_verify completo", async () => {
    const env = await e2eEnv();
    const target = join(env.root, "acme");

    const plan = await projectPlan(env.ctx, { spec: E2E_SPEC, target });
    expect(plan.isError, plan.text.slice(0, 600)).toBe(false);
    const created = await projectCreate(env.ctx, { plan_id: JSON.parse(plan.text).plan_id });
    expect(created.isError, created.text.slice(0, 1500)).toBe(false);
    await writeFile(env.projectsFile, `projects:\n  acme:\n    path: ${target}\n`);

    // 1) app nueva
    const p1 = await appPlan(env.ctx, { project_path: target, key: "supp", user_type: "new" });
    expect(p1.isError, p1.text.slice(0, 1500)).toBe(false);
    const planned1 = JSON.parse(p1.text);
    expect(planned1.conflicts).toEqual([]);
    const c1 = await appCreate(env.ctx, { plan_id: planned1.plan_id });
    expect(c1.isError, c1.text.slice(0, 3000)).toBe(false);

    // 2) segunda app reutilizando un tipo de usuario existente (modelo escrito por el dueño)
    await write(target, "app/Models/Partner.php", PARTNER_MODEL);
    await write(target, "database/factories/PartnerFactory.php", PARTNER_FACTORY);
    await write(target, "database/migrations/2025_10_01_000100_create_partners_table.php", PARTNER_MIGRATION);
    const p2 = await appPlan(env.ctx, { project_path: target, key: "partner", user_type: "existing", model: "Partner" });
    expect(p2.isError, p2.text.slice(0, 1500)).toBe(false);
    const planned2 = JSON.parse(p2.text);
    expect(planned2.conflicts).toEqual([]);
    expect(planned2.files_to_create.some((f: { path: string }) => f.path.startsWith("database/"))).toBe(false);
    const c2 = await appCreate(env.ctx, { plan_id: planned2.plan_id });
    expect(c2.isError, c2.text.slice(0, 3000)).toBe(false);

    await write(target, "tests/Feature/AddedAppsIsolationTest.php", EXTRA_ISOLATION_TEST);

    const lock = parse(await readFile(join(target, ".ops/lock.yaml"), "utf8"));
    expect(lock.spec.apps.map((a: { key: string }) => a.key)).toEqual(["web", "adm", "supp", "partner"]);
    expect(lock.files.some((f: { path: string }) => f.path === "routes/api/partner.php")).toBe(true);

    const verified = await projectVerify(env.ctx, { project: "acme" });
    expect(verified.isError, verified.text.slice(0, 4000)).toBe(false);
    const steps = (JSON.parse(verified.text).steps as Array<{ name: string; ok: boolean }>).map((s) => s.name);
    expect(steps).toEqual(expect.arrayContaining(["composer-install", "migrate-sqlite", "phpunit", "pnpm-types", "pnpm-build", "docker-compose-config"]));
    for (const app of ["web", "adm", "supp", "partner"]) {
      const out = await readFile(join(target, "public", `build-${app}`, "manifest.json"), "utf8").catch(() => "");
      expect(out, `build de ${app}`).not.toBe("");
    }
  });
});
