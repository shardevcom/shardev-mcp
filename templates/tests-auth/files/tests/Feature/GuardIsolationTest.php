<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Concerns\AuthApps;
use Tests\TestCase;

/**
 * Un token emitido para una app NO debe servir en otra, aunque las cuentas de las dos apps
 * compartan el mismo id (el ataque clásico: usuario 1 de `web` contra administrador 1 de `adm`).
 */
class GuardIsolationTest extends TestCase
{
    use AuthApps;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAuthApps();
    }

    public function test_el_proyecto_tiene_al_menos_dos_apps_para_probar_el_aislamiento(): void
    {
        $this->assertGreaterThanOrEqual(2, count($this->apps()), 'Añade una segunda app (o un factory) para probar el aislamiento entre guards.');
    }

    public function test_un_token_de_cada_app_funciona_en_la_suya_y_se_rechaza_en_las_demas(): void
    {
        $accounts = [];
        foreach (array_keys($this->apps()) as $app) {
            $accounts[$app] = $this->makeAccount($app);
        }

        // Mismo id en todas las tablas: sin aislamiento por provider, el token cruzaría.
        $ids = array_unique(array_map(fn ($a) => $a->getKey(), $accounts));
        $this->assertCount(1, $ids, 'Las cuentas de prueba deben compartir id.');

        foreach ($accounts as $own => $account) {
            $headers = $this->bearer($account);

            $this->as($headers)->getJson("/api/{$own}/profile")->assertOk()->assertJsonPath('data.email', $account->email);

            foreach (array_keys($accounts) as $other) {
                if ($other === $own) {
                    continue;
                }
                $this->as($headers)->getJson("/api/{$other}/profile")->assertUnauthorized();
                $this->as($headers)->getJson("/api/{$other}/roles")->assertUnauthorized();
                $this->as($headers)->postJson("/api/{$other}/logout")->assertUnauthorized();
            }
        }
    }

    public function test_sin_token_las_rutas_protegidas_devuelven_401(): void
    {
        foreach (array_keys($this->apps()) as $app) {
            $this->getJson("/api/{$app}/profile")->assertUnauthorized();
            $this->getJson("/api/{$app}/roles")->assertUnauthorized();
        }
    }
}
