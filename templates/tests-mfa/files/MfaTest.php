<?php

namespace Tests\Feature;

use {{ app.model_class }};
use {{ app.mfa_model_class }};
use {{ app.mfa_service_class }};
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Route;
use Laravel\Passport\Token;
use PragmaRX\Google2FA\Google2FA;
use ReflectionMethod;
use Shardevcom\Authentications\Http\Controllers\AccountAuthController;
use Tests\Feature\Concerns\AuthApps;
use Tests\TestCase;

/**
 * Segundo factor (TOTP) de la app `{{ app.key }}`. Cada caso permitido tiene su caso rechazado. Los códigos se
 * calculan en la prueba con la misma librería (nunca viajan en una respuesta de login ni se registran).
 */
class {{ app.model }}MfaTest extends TestCase
{
    use AuthApps;
    use RefreshDatabase;

    private const APP = '{{ app.key }}';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAuthApps();
    }

    private function url(string $path = ''): string
    {
        return '/api/' . self::APP . '/auth/mfa' . ($path === '' ? '' : '/' . $path);
    }

    private function signin({{ app.model }} $account)
    {
        return $this->postJson('/api/' . self::APP . '/auth/signin', ['email' => $account->email, 'password' => self::TEST_PASSWORD]);
    }

    /** Código TOTP del paso actual (+ $steps). */
    private function totp(string $secret, int $steps = 0): string
    {
        $g = new Google2FA();

        return $g->oathTotp($secret, $g->getTimestamp() + $steps);
    }

    /** Un código que no es el de ninguno de los pasos aceptados. */
    private function wrongCode(string $secret): string
    {
        $valid = [$this->totp($secret, -1), $this->totp($secret), $this->totp($secret, 1)];
        foreach (['000000', '111111', '222222'] as $c) {
            if (! in_array($c, $valid, true)) {
                return $c;
            }
        }

        return '333333';
    }

    /** Activa el MFA de la cuenta. @return array{0: string, 1: list<string>} [secreto, códigos de recuperación] */
    private function enroll({{ app.model }} $account): array
    {
        $headers = $this->bearer($account);
        $secret = $this->as($headers)->postJson($this->url('setup'))->assertOk()->json('data.secret');
        $codes = $this->as($headers)->postJson($this->url('confirm'), ['code' => $this->totp($secret)])->assertOk()->json('data.recovery_codes');

        return [$secret, $codes];
    }

    /** El paso aceptado más reciente bloquea repetir códigos: para una segunda entrada válida en la misma prueba. */
    private function forgetLastStep({{ app.model }} $account): void
    {
        DB::table('{{ app.table }}_mfa')->where('account_id', $account->getKey())->update(['last_used_step' => 0]);
    }

    /** Inicia sesión y devuelve el valor del desafío. */
    private function challengeFor({{ app.model }} $account): string
    {
        $res = $this->signin($account)->assertOk();
        $this->assertTrue($res->json('data.mfa_required'));

        return $res->json('data.challenge');
    }

    private function verify(string $challenge, string $code)
    {
        return $this->postJson($this->url('verify'), ['challenge' => $challenge, 'code' => $code]);
    }

    public function test_una_cuenta_sin_mfa_inicia_sesion_como_siempre(): void
    {
        $account = $this->makeAccount(self::APP);

        $res = $this->signin($account)->assertOk();

        $this->assertNotEmpty($res->json('data.access_token'));
        $this->assertNull($res->json('data.mfa_required'));
    }

    public function test_el_alta_es_setup_y_confirmacion_y_el_pendiente_no_protege_nada(): void
    {
        $account = $this->makeAccount(self::APP);
        $headers = $this->bearer($account);

        $setup = $this->as($headers)->postJson($this->url('setup'))->assertOk();
        $secret = $setup->json('data.secret');
        $this->assertSame(32, strlen($secret));
        $this->assertStringStartsWith('otpauth://totp/', $setup->json('data.otpauth_url'));
        $this->assertStringContainsString('secret=' . $secret, $setup->json('data.otpauth_url'));

        // Pendiente: el login sigue devolviendo token y el estado lo dice.
        $this->assertNotEmpty($this->signin($account)->json('data.access_token'));
        $this->as($headers)->getJson($this->url())->assertOk()->assertJsonPath('data.enabled', false)->assertJsonPath('data.pending', true);

        // Un código malo no activa nada.
        $this->as($headers)->postJson($this->url('confirm'), ['code' => $this->wrongCode($secret)])->assertStatus(422);
        $this->assertNotEmpty($this->signin($account)->json('data.access_token'));

        // El bueno sí.
        $res = $this->as($headers)->postJson($this->url('confirm'), ['code' => $this->totp($secret)])->assertOk();
        $this->assertCount((int) config('mfa_{{ app.key }}.recovery_codes'), $res->json('data.recovery_codes'));
        $this->as($headers)->getJson($this->url())->assertOk()->assertJsonPath('data.enabled', true)->assertJsonPath('data.pending', false);
    }

    public function test_confirmar_sin_haber_hecho_setup_se_rechaza_y_activar_dos_veces_se_niega(): void
    {
        $account = $this->makeAccount(self::APP);
        $headers = $this->bearer($account);

        $this->as($headers)->postJson($this->url('confirm'), ['code' => '123456'])->assertStatus(422);

        $this->enroll($account);
        // Activar cerró la sesión anterior: se entra con un token nuevo.
        $this->as($this->bearer($account))->postJson($this->url('setup'))->assertStatus(409);
    }

    public function test_el_secreto_se_guarda_cifrado_y_los_codigos_de_recuperacion_hasheados(): void
    {
        $account = $this->makeAccount(self::APP);
        [$secret, $codes] = $this->enroll($account);

        $row = DB::table('{{ app.table }}_mfa')->where('account_id', $account->getKey())->first();
        $this->assertNotSame($secret, $row->secret);
        $this->assertStringNotContainsString($secret, json_encode($row));
        $this->assertSame($secret, Crypt::decryptString($row->secret));

        foreach ($codes as $code) {
            $this->assertStringNotContainsString($code, json_encode($row));
            $this->assertStringNotContainsString(str_replace('-', '', $code), json_encode($row));
        }
        $this->assertCount(count($codes), json_decode($row->recovery_codes, true));

        // El secreto no se filtra por ninguna respuesta.
        $this->as($this->bearer($account))->getJson('/api/' . self::APP . '/profile')->assertOk();
        $this->assertStringNotContainsString($secret, $this->as($this->bearer($account))->getJson($this->url())->getContent());
        $this->assertStringNotContainsString($secret, $this->as($this->bearer($account))->getJson('/api/' . self::APP . '/profile')->getContent());
    }

    public function test_con_mfa_el_login_no_devuelve_token_solo_un_desafio_opaco(): void
    {
        $account = $this->makeAccount(self::APP);
        $this->enroll($account);
        $tokensBefore = DB::table('oauth_access_tokens')->where('user_id', $account->getKey())->count();

        $res = $this->signin($account)->assertOk();

        $this->assertNull($res->json('data.access_token'));
        $this->assertTrue($res->json('data.mfa_required'));
        $challenge = $res->json('data.challenge');
        $this->assertGreaterThanOrEqual(32, strlen($challenge));
        $this->assertStringNotContainsString('access_token', $res->getContent());
        $this->assertSame($tokensBefore, DB::table('oauth_access_tokens')->where('user_id', $account->getKey())->count(), 'el login no debe crear ningún token');

        // El desafío se guarda hasheado, ligado a la cuenta.
        $this->assertSame(0, DB::table('{{ app.table }}_mfa_challenges')->where('token_hash', $challenge)->count());
        $row = DB::table('{{ app.table }}_mfa_challenges')->where('token_hash', hash('sha256', $challenge))->first();
        $this->assertNotNull($row);
        $this->assertSame($account->getKey(), (int) $row->account_id);
        $this->assertStringNotContainsString($challenge, json_encode(DB::table('{{ app.table }}_mfa_challenges')->get()));
    }

    public function test_el_codigo_correcto_canjea_el_desafio_por_un_token_que_sirve(): void
    {
        $account = $this->makeAccount(self::APP);
        [$secret] = $this->enroll($account);
        $challenge = $this->challengeFor($account);

        $res = $this->verify($challenge, $this->totp($secret, 1))->assertOk();

        $token = $res->json('data.access_token');
        $this->assertNotEmpty($token);
        $res->assertJsonPath('data.email', $account->email);
        $this->assertArrayNotHasKey('password', $res->json('data'));
        $this->as(['Authorization' => "Bearer {$token}"])->getJson('/api/' . self::APP . '/profile')->assertOk();
    }

    public function test_un_codigo_incorrecto_se_rechaza_igual_que_un_desafio_inexistente(): void
    {
        $account = $this->makeAccount(self::APP);
        [$secret] = $this->enroll($account);
        $challenge = $this->challengeFor($account);

        $bad = $this->verify($challenge, $this->wrongCode($secret));
        $none = $this->verify(str_repeat('a', 43), $this->totp($secret, 1));

        $bad->assertStatus(401);
        $none->assertStatus(401);
        $this->assertSame($bad->json(), $none->json());
        $this->assertNull($bad->json('data.access_token'));

        // Un fallo suelto no quema el desafío.
        $this->verify($challenge, $this->totp($secret, 1))->assertOk();
    }

    public function test_el_desafio_se_bloquea_tras_los_intentos_maximos_aunque_llegue_el_codigo_bueno(): void
    {
        $account = $this->makeAccount(self::APP);
        [$secret] = $this->enroll($account);
        $challenge = $this->challengeFor($account);

        for ($i = 0; $i < (int) config('mfa_{{ app.key }}.challenge_max_attempts'); $i++) {
            $this->verify($challenge, $this->wrongCode($secret))->assertStatus(401);
        }

        $this->verify($challenge, $this->totp($secret, 1))->assertStatus(401);
    }

    public function test_la_cuenta_se_bloquea_tras_demasiados_fallos_aunque_se_pidan_desafios_nuevos(): void
    {
        // Topes bajos para no chocar con el throttle por IP de la ruta (que es otra capa).
        config(['mfa_{{ app.key }}.account_max_failures' => 4, 'mfa_{{ app.key }}.challenge_max_attempts' => 2]);
        $account = $this->makeAccount(self::APP);
        [$secret] = $this->enroll($account);

        foreach ([1, 2] as $_) {
            $challenge = $this->challengeFor($account);
            $this->verify($challenge, $this->wrongCode($secret))->assertStatus(401);
            $this->verify($challenge, $this->wrongCode($secret))->assertStatus(401);
        }

        // Ya no se aceptan códigos de esta cuenta, ni siquiera el bueno en un desafío nuevo.
        $this->verify($this->challengeFor($account), $this->totp($secret, 1))->assertStatus(401);
    }

    public function test_un_codigo_ya_aceptado_no_se_puede_reutilizar(): void
    {
        $account = $this->makeAccount(self::APP);
        [$secret] = $this->enroll($account);

        // El código del paso siguiente se acepta una vez...
        $code = $this->totp($secret, 1);
        $this->verify($this->challengeFor($account), $code)->assertOk();

        // ...y ni él ni el del paso actual (más viejo) valen después, con un desafío nuevo y válido.
        $this->verify($this->challengeFor($account), $code)->assertStatus(401);
        $this->verify($this->challengeFor($account), $this->totp($secret))->assertStatus(401);
    }

    public function test_dos_desafios_vigentes_no_aceptan_el_mismo_paso_dos_veces(): void
    {
        $account = $this->makeAccount(self::APP);
        [$secret] = $this->enroll($account);
        $a = $this->challengeFor($account);
        $b = $this->challengeFor($account);
        $code = $this->totp($secret, 1);

        // Mismo código en dos desafíos distintos "a la vez": solo el primero avanza el paso; el segundo ve el paso gastado.
        $this->verify($a, $code)->assertOk();
        $this->verify($b, $code)->assertStatus(401);
    }

    public function test_dos_peticiones_simultaneas_con_el_mismo_codigo_no_pasan_las_dos(): void
    {
        $account = $this->makeAccount(self::APP);
        [$secret] = $this->enroll($account);
        $this->forgetLastStep($account);
        $code = $this->totp($secret, 1);

        // Dos peticiones en vuelo leyeron la MISMA fila (último paso = 0). Se simula reusando esa lectura vieja:
        // la verificación en memoria pasa las dos veces, así que solo el UPDATE condicional atómico las distingue.
        $stale = {{ app.model }}Mfa::query()->where('account_id', $account->getKey())->firstOrFail();
        $claim = new ReflectionMethod({{ app.model }}MfaService::class, 'claimTotp');
        $service = app({{ app.model }}MfaService::class);

        $this->assertIsInt($claim->invoke($service, $stale, $code));
        $this->assertFalse($claim->invoke($service, $stale, $code));
    }

    public function test_un_desafio_se_canjea_una_sola_vez(): void
    {
        $account = $this->makeAccount(self::APP);
        [$secret, $codes] = $this->enroll($account);
        $challenge = $this->challengeFor($account);

        $this->verify($challenge, $this->totp($secret, 1))->assertOk();
        $this->verify($challenge, $codes[0])->assertStatus(401);
    }

    public function test_un_desafio_caducado_se_rechaza(): void
    {
        $account = $this->makeAccount(self::APP);
        [$secret] = $this->enroll($account);
        $challenge = $this->challengeFor($account);

        $this->travel((int) config('mfa_{{ app.key }}.challenge_ttl_seconds') + 1)->seconds();

        $this->verify($challenge, $this->totp($secret, 1))->assertStatus(401);
    }

    public function test_un_desafio_esta_ligado_a_su_cuenta(): void
    {
        $a = $this->makeAccount(self::APP);
        $b = $this->makeAccount(self::APP);
        [$secretA] = $this->enroll($a);
        [$secretB] = $this->enroll($b);

        // Desafío de A con el código (válido) de B.
        $this->verify($this->challengeFor($a), $this->totp($secretB, 1))->assertStatus(401);
        // Y el de A sigue sirviendo a A.
        $this->verify($this->challengeFor($a), $this->totp($secretA, 1))->assertOk();
    }

    public function test_un_desafio_de_otra_app_no_sirve_aqui_ni_al_reves(): void
    {
        $account = $this->makeAccount(self::APP);
        [$secret] = $this->enroll($account);
        $challenge = $this->challengeFor($account);
        $code = $this->totp($secret, 1);
        $others = array_values(array_filter(array_keys($this->apps()), fn (string $o) => $o !== self::APP));

        foreach ($others as $other) {
            if (Route::has("{$other}.mfa.verify")) {
                $this->postJson("/api/{$other}/auth/mfa/verify", ['challenge' => $challenge, 'code' => $code])->assertStatus(401);
            }
        }

        // El desafío vive en la tabla de ESTA app y no se quemó por intentarlo en otra.
        $this->assertSame(1, DB::table('{{ app.table }}_mfa_challenges')->where('token_hash', hash('sha256', $challenge))->count());
        $token = $this->verify($challenge, $code)->assertOk()->json('data.access_token');

        // El token resultante tampoco vale en otra app.
        foreach ($others as $other) {
            $this->as(['Authorization' => "Bearer {$token}"])->getJson("/api/{$other}/profile")->assertUnauthorized();
        }
    }

    public function test_un_codigo_de_recuperacion_sirve_una_sola_vez(): void
    {
        $account = $this->makeAccount(self::APP);
        [, $codes] = $this->enroll($account);

        $this->verify($this->challengeFor($account), strtoupper($codes[0]))->assertOk();
        $this->verify($this->challengeFor($account), $codes[0])->assertStatus(401);
        // Otro código distinto sigue valiendo.
        $this->verify($this->challengeFor($account), $codes[1])->assertOk();
        $this->as($this->bearer($account))->getJson($this->url())->assertJsonPath('data.recovery_codes_remaining', count($codes) - 2);
    }

    public function test_una_cuenta_inactiva_no_canjea_su_desafio(): void
    {
        $account = $this->makeAccount(self::APP);
        [$secret] = $this->enroll($account);
        $challenge = $this->challengeFor($account);

        $account->forceFill(['active' => false])->save();

        $this->verify($challenge, $this->totp($secret, 1))->assertStatus(401);
    }

    public function test_activar_cierra_las_otras_sesiones_y_conserva_la_actual(): void
    {
        $account = $this->makeAccount(self::APP);
        $other = $account->createToken('otra-sesion');
        $headers = $this->bearer($account);

        $secret = $this->as($headers)->postJson($this->url('setup'))->assertOk()->json('data.secret');
        $this->as($headers)->postJson($this->url('confirm'), ['code' => $this->totp($secret)])->assertOk();

        $this->assertTrue(Token::find($other->token->id)->revoked);
        $this->as($headers)->getJson('/api/' . self::APP . '/profile')->assertOk();
    }

    public function test_desactivar_exige_la_contrasena_y_un_codigo_validos(): void
    {
        $account = $this->makeAccount(self::APP);
        [$secret, $codes] = $this->enroll($account);
        $other = $account->createToken('otra-sesion');
        $headers = $this->bearer($account);

        // Solo el código (contraseña mala): rechazado.
        $this->as($headers)->postJson($this->url('disable'), ['password' => self::WRONG_PASSWORD, 'code' => $this->totp($secret, 1)])->assertStatus(422);
        // Solo la contraseña (código malo): rechazado.
        $this->as($headers)->postJson($this->url('disable'), ['password' => self::TEST_PASSWORD, 'code' => $this->wrongCode($secret)])->assertStatus(422);
        $this->assertTrue({{ app.model }}Mfa::query()->where('account_id', $account->getKey())->exists());

        // Las dos cosas: se desactiva, cierra las otras sesiones y el login vuelve a dar token.
        $this->as($headers)->postJson($this->url('disable'), ['password' => self::TEST_PASSWORD, 'code' => $codes[0]])->assertOk();
        $this->assertFalse({{ app.model }}Mfa::query()->where('account_id', $account->getKey())->exists());
        $this->assertTrue(Token::find($other->token->id)->revoked);
        $this->assertNotEmpty($this->signin($account)->json('data.access_token'));
    }

    public function test_desactivar_sin_mfa_activo_se_niega(): void
    {
        $account = $this->makeAccount(self::APP);

        $this->as($this->bearer($account))->postJson($this->url('disable'), ['password' => self::TEST_PASSWORD, 'code' => '123456'])->assertStatus(409);
    }

    public function test_regenerar_los_codigos_de_recuperacion_exige_ambos_factores_e_invalida_los_viejos(): void
    {
        $account = $this->makeAccount(self::APP);
        [$secret, $codes] = $this->enroll($account);
        $headers = $this->bearer($account);

        $this->as($headers)->postJson($this->url('recovery-codes'), ['password' => self::WRONG_PASSWORD, 'code' => $this->totp($secret, 1)])->assertStatus(422);
        $this->as($headers)->postJson($this->url('recovery-codes'), ['password' => self::TEST_PASSWORD, 'code' => $this->wrongCode($secret)])->assertStatus(422);

        $new = $this->as($headers)->postJson($this->url('recovery-codes'), ['password' => self::TEST_PASSWORD, 'code' => $this->totp($secret, 1)])->assertOk()->json('data.recovery_codes');
        $this->assertCount((int) config('mfa_{{ app.key }}.recovery_codes'), $new);
        $this->assertEmpty(array_intersect($new, $codes));

        $this->verify($this->challengeFor($account), $codes[0])->assertStatus(401);
        $this->verify($this->challengeFor($account), $new[0])->assertOk();
    }

    public function test_las_rutas_de_mfa_exigen_un_token_de_esta_app(): void
    {
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();
        $this->getJson($this->url())->assertUnauthorized();
        foreach (['setup', 'confirm', 'disable', 'recovery-codes'] as $path) {
            $this->postJson($this->url($path), ['code' => '123456', 'password' => 'x'])->assertUnauthorized();
        }

        foreach (array_keys($this->apps()) as $other) {
            if ($other !== self::APP) {
                $foreign = $this->makeAccount($other);
                $this->as($this->bearer($foreign))->postJson($this->url('setup'))->assertUnauthorized();
            }
        }
    }

    public function test_las_rutas_de_mfa_tienen_throttle(): void
    {
        $account = $this->makeAccount(self::APP);
        $headers = $this->bearer($account);

        for ($i = 0; $i < 10; $i++) {
            $this->verify(str_repeat('a', 43), '123456')->assertStatus(401);
        }
        $this->verify(str_repeat('a', 43), '123456')->assertStatus(429);

        for ($i = 0; $i < 5; $i++) {
            $this->as($headers)->postJson($this->url('disable'), ['password' => self::WRONG_PASSWORD, 'code' => '123456'])->assertStatus(409);
        }
        $this->as($headers)->postJson($this->url('disable'), ['password' => self::WRONG_PASSWORD, 'code' => '123456'])->assertStatus(429);
    }

    public function test_ni_el_codigo_ni_el_secreto_ni_el_desafio_quedan_en_los_logs(): void
    {
        Log::spy();
        $account = $this->makeAccount(self::APP);
        [$secret, $codes] = $this->enroll($account);
        $challenge = $this->challengeFor($account);
        $this->verify($challenge, $this->wrongCode($secret))->assertStatus(401);
        $this->verify($challenge, $this->totp($secret, 1))->assertOk();
        $this->verify($this->challengeFor($account), $codes[0])->assertOk();

        foreach (['info', 'warning', 'error', 'debug', 'notice', 'critical', 'alert', 'emergency'] as $level) {
            Log::shouldNotHaveReceived($level);
        }
    }

    // --- Todos los caminos que emiten token en esta app respetan el segundo factor ---

    public function test_el_signin_de_la_app_no_es_el_de_la_clase_base(): void
    {
        $route = Route::getRoutes()->getByName(self::APP . '.signin');
        $this->assertNotNull($route);

        [$class, $method] = explode('@', $route->getActionName());
        $this->assertTrue(is_subclass_of($class, AccountAuthController::class));
        $this->assertNotSame(AccountAuthController::class, (new ReflectionMethod($class, $method))->getDeclaringClass()->getName(), 'signin no debe ser el de la clase base: emite el token sin segundo factor');
    }

    public function test_solo_hay_rutas_publicas_conocidas_en_la_app(): void
    {
        $guard = '{{ app.api_guard }}';
        $public = array_map(fn ($n) => self::APP . '.' . $n, ['signin', 'mfa.verify', 'invitations.accept']);

        $unauthenticated = [];
        foreach (Route::getRoutes() as $route) {
            if (! str_starts_with($route->uri(), 'api/' . self::APP . '/')) {
                continue;
            }
            if (! in_array("auth:{$guard}", $route->gatherMiddleware(), true)) {
                $unauthenticated[] = (string) $route->getName();
            }
        }

        $this->assertEmpty(array_diff($unauthenticated, $public), 'rutas públicas inesperadas: ' . implode(', ', array_diff($unauthenticated, $public)));
    }

    public function test_el_flujo_oauth_de_passport_no_emite_tokens_de_cuenta(): void
    {
        $account = $this->makeAccount(self::APP);
        $this->enroll($account);

        foreach (['password', 'client_credentials', 'authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:device_code'] as $grant) {
            $res = $this->postJson('/oauth/token', [
                'grant_type' => $grant,
                'client_id' => '1',
                'client_secret' => 'not-a-real-secret', // shardev-allow-secret: dato de prueba
                'username' => $account->email,
                'password' => self::TEST_PASSWORD,
                'scope' => '',
            ]);

            $this->assertGreaterThanOrEqual(400, $res->getStatusCode(), "grant {$grant}");
            $this->assertStringNotContainsString('access_token', $res->getContent(), "grant {$grant}");
        }
    }
}
