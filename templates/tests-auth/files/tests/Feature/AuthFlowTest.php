<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Passport\Token;
use Tests\Feature\Concerns\AuthApps;
use Tests\TestCase;

class AuthFlowTest extends TestCase
{
    use AuthApps;
    use RefreshDatabase;

    private const NEW_PASSWORD = 'una-clave-larga-1'; // shardev-allow-secret: dato de prueba

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAuthApps();
    }

    public function test_login_correcto_devuelve_token_y_el_perfil_funciona(): void
    {
        foreach (array_keys($this->passwordApps()) as $app) {
            $account = $this->makeAccount($app);

            $res = $this->postJson("/api/{$app}/auth/signin", ['email' => $account->email, 'password' => self::TEST_PASSWORD]);

            $res->assertOk()->assertJsonPath('data.email', $account->email);
            $token = $res->json('data.access_token');
            $this->assertNotEmpty($token);
            $this->assertArrayNotHasKey('password', $res->json('data'));

            $this->as(['Authorization' => "Bearer {$token}"])->getJson("/api/{$app}/profile")->assertOk();
        }
    }

    public function test_credenciales_invalidas_y_cuenta_inactiva_dan_la_misma_respuesta(): void
    {
        foreach (array_keys($this->passwordApps()) as $app) {
            $active = $this->makeAccount($app);
            $inactive = $this->makeAccount($app, ['active' => false]);

            $wrong = $this->postJson("/api/{$app}/auth/signin", ['email' => $active->email, 'password' => self::WRONG_PASSWORD]);
            $off = $this->postJson("/api/{$app}/auth/signin", ['email' => $inactive->email, 'password' => self::TEST_PASSWORD]);
            $none = $this->postJson("/api/{$app}/auth/signin", ['email' => 'nadie@example.com', 'password' => 'x']);

            foreach ([$wrong, $off, $none] as $r) {
                $r->assertStatus(401);
            }
            $this->assertSame($wrong->json('message'), $off->json('message'));
            $this->assertSame($wrong->json('message'), $none->json('message'));
        }
    }

    public function test_logout_revoca_el_token(): void
    {
        foreach (array_keys($this->apps()) as $app) {
            $account = $this->makeAccount($app);
            $token = $account->createToken('t');
            $headers = ['Authorization' => 'Bearer ' . $token->accessToken];

            $this->as($headers)->postJson("/api/{$app}/logout")->assertOk();

            $this->assertTrue(Token::find($token->token->id)->revoked);
            $this->as($headers)->getJson("/api/{$app}/profile")->assertUnauthorized();
        }
    }

    public function test_el_perfil_solo_actualiza_campos_propios(): void
    {
        foreach (array_keys($this->apps()) as $app) {
            $account = $this->makeAccount($app);

            $this->as($this->bearer($account))
                ->patchJson("/api/{$app}/profile", ['name' => 'Nuevo Nombre', 'active' => false, 'email' => 'otro@example.com', 'id' => 999])
                ->assertOk();

            $fresh = $account->fresh();
            $this->assertSame('Nuevo Nombre', $fresh->name);
            $this->assertTrue($fresh->active);
            $this->assertNotSame('otro@example.com', $fresh->email);
            $this->assertSame($account->getKey(), $fresh->getKey());
        }
    }

    public function test_cambio_de_contrasena_exige_la_actual_y_revoca_las_otras_sesiones(): void
    {
        foreach (array_keys($this->passwordApps()) as $app) {
            $account = $this->makeAccount($app);
            $other = $account->createToken('otra-sesion');
            $headers = $this->bearer($account);

            $this->as($headers)->postJson("/api/{$app}/auth/change-password", ['current_password' => 'mal', 'new_password' => self::NEW_PASSWORD])->assertStatus(422);

            $this->as($headers)->postJson("/api/{$app}/auth/change-password", ['current_password' => self::TEST_PASSWORD, 'new_password' => self::NEW_PASSWORD])->assertOk();

            $this->assertTrue(Token::find($other->token->id)->revoked);
            $this->postJson("/api/{$app}/auth/signin", ['email' => $account->email, 'password' => self::NEW_PASSWORD])->assertOk();
        }
    }

    public function test_roles_permitidos_con_permiso_y_prohibidos_sin_el(): void
    {
        foreach (array_keys($this->apps()) as $app) {
            $admin = $this->makeAccount($app, [], 'admin');
            $user = $this->makeAccount($app, [], 'user');

            $this->as($this->bearer($admin))->getJson("/api/{$app}/roles")->assertOk();
            $this->as($this->bearer($user))->getJson("/api/{$app}/roles")->assertForbidden();
        }
    }

    public function test_authentications_setup_es_idempotente_y_crea_un_cliente_por_provider(): void
    {
        $this->artisan('authentications:setup')->assertSuccessful();
        $this->artisan('authentications:setup')->assertSuccessful();

        $providers = collect($this->apps())->pluck('provider')->unique();
        foreach ($providers as $provider) {
            $this->assertSame(1, \DB::table('oauth_clients')->where('provider', $provider)->count(), "cliente personal de {$provider}");
        }
    }
}
