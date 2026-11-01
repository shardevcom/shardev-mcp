<?php

namespace Tests\Feature;

use {{ app.model_class }};
use {{ app.social_identity_class }};
use Firebase\JWT\JWT;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Tests\Feature\Concerns\AuthApps;
use Tests\TestCase;

/**
 * Login social de la app `{{ app.key }}`, contra un proveedor SIMULADO: las llaves se generan en cada
 * ejecución (nada de llaves en el repositorio) y el JWKS de cada proveedor se sirve con Http::fake.
 * No se llama a Google, Microsoft ni Apple. Cada caso permitido tiene su caso rechazado.
 */
class {{ app.model }}SocialLoginTest extends TestCase
{
    use AuthApps;
    use RefreshDatabase;

    private const APP = '{{ app.key }}';
    private const MS_ISSUER = 'https://login.microsoftonline.com/00000000-0000-4000-8000-000000000001/v2.0';

    /** @var array{0: string, 1: array<string, string>}|null  [pem privado, jwk público] del proveedor de confianza */
    private static ?array $trusted = null;

    /** @var array{0: string, 1: array<string, string>}|null  llave de un atacante: otra pareja, mismo kid */
    private static ?array $attacker = null;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAuthApps();

        self::$trusted ??= $this->newKeypair('test-kid');
        self::$attacker ??= $this->newKeypair('test-kid');

        config([
            'services.google.client_id' => 'test-google-client',
            'services.google.native_client_id' => 'test-google-native',
            'services.microsoft.client_id' => 'test-microsoft-client',
            'services.microsoft.tenant' => 'consumers',
            'services.apple.client_id' => 'test.apple.service',
            'services.apple.bundle_id' => 'test.apple.bundle',
        ]);
        $this->fakeProviders(self::$trusted[1]);
    }

    // ---- utilidades de prueba ----------------------------------------------------------------------------------

    private function b64(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    /** @return array{0: string, 1: array<string, string>} */
    private function newKeypair(string $kid): array
    {
        $key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
        openssl_pkey_export($key, $pem);
        $d = openssl_pkey_get_details($key);

        return [$pem, ['kty' => 'RSA', 'kid' => $kid, 'use' => 'sig', 'alg' => 'RS256', 'n' => $this->b64($d['rsa']['n']), 'e' => $this->b64($d['rsa']['e'])]];
    }

    /** @param array<string, string> $jwk */
    private function fakeProviders(array $jwk): void
    {
        Cache::flush();
        Http::swap(new HttpFactory()); // sin restos de stubs anteriores
        Http::fake([
            'accounts.google.com/.well-known/risc-configuration' => Http::response(['issuer' => 'https://accounts.google.com', 'jwks_uri' => 'https://www.googleapis.com/oauth2/v3/certs']),
            'www.googleapis.com/oauth2/v3/certs' => Http::response(['keys' => [$jwk]]),
            'login.microsoftonline.com/*/v2.0/.well-known/openid-configuration' => Http::response(['issuer' => self::MS_ISSUER, 'jwks_uri' => 'https://login.microsoftonline.com/common/discovery/v2.0/keys']),
            'login.microsoftonline.com/common/discovery/v2.0/keys' => Http::response(['keys' => [array_diff_key($jwk, ['alg' => 1])]]), // Microsoft publica las claves sin "alg"
            'appleid.apple.com/auth/keys' => Http::response(['keys' => [$jwk]]),
        ]);
        Http::preventStrayRequests(); // cualquier otra URL es un error: ninguna prueba toca a un proveedor real
    }

    /** @return list<string> */
    private function providers(): array
    {
        return config('social_' . self::APP . '.providers');
    }

    /** Claims válidos para un proveedor; `$over` los sobrescribe (un null quita el claim). */
    private function claims(string $provider, array $over = []): array
    {
        $now = time();
        $base = match ($provider) {
            'google' => ['iss' => 'https://accounts.google.com', 'aud' => 'test-google-client', 'email_verified' => true],
            'microsoft' => ['iss' => self::MS_ISSUER, 'aud' => 'test-microsoft-client'],
            'apple' => ['iss' => 'https://appleid.apple.com', 'aud' => 'test.apple.service', 'email_verified' => 'true'],
        };

        $claims = array_merge($base, ['sub' => 'sub-' . $provider . '-1', 'email' => 'persona@example.com', 'iat' => $now, 'exp' => $now + 600], $over);

        return array_filter($claims, fn ($v) => $v !== null);
    }

    /** id_token firmado con la llave de confianza (o la que se indique). */
    private function token(string $provider, array $over = [], ?array $keypair = null): string
    {
        [$pem, $jwk] = $keypair ?? self::$trusted;

        return JWT::encode($this->claims($provider, $over), $pem, 'RS256', $jwk['kid']);
    }

    /**
     * Las rutas públicas llevan throttle (hay una prueba aparte para eso); aquí se vacía el contador entre
     * peticiones para que los bucles por proveedor no choquen con él. También vacía la caché del JWKS: se
     * vuelve a pedir al proveedor simulado.
     */
    private function loginWith(string $provider, string $idToken, array $extra = [])
    {
        Cache::flush();

        return $this->postJson('/api/' . self::APP . "/auth/social/{$provider}", ['id_token' => $idToken] + $extra);
    }

    private function identities(): int
    {
        return {{ app.model }}SocialIdentity::query()->count();
    }

    /** Proveedores que enlazan por correo verificado (Microsoft no: ver la nota del servicio). */
    private function linksByEmail(string $provider): bool
    {
        return $provider !== 'microsoft';
    }

    // ---- permitido ----------------------------------------------------------------------------------------------

    public function test_un_token_valido_con_correo_verificado_enlaza_la_cuenta_y_entra(): void
    {
        foreach ($this->providers() as $provider) {
            if (! $this->linksByEmail($provider)) {
                continue;
            }
            $account = $this->makeAccount(self::APP, ['email' => "persona-{$provider}@example.com"]);

            $res = $this->loginWith($provider, $this->token($provider, ['email' => $account->email]))->assertOk();
            $res->assertJsonPath('data.email', $account->email);
            $token = $res->json('data.access_token');
            $this->assertNotEmpty($token);

            $this->assertDatabaseHas('{{ app.table }}_social_identities', ['account_id' => $account->getKey(), 'provider' => $provider, 'subject' => "sub-{$provider}-1"]);
            $this->as(['Authorization' => "Bearer {$token}"])->getJson('/api/' . self::APP . '/profile')->assertOk();
        }
    }

    public function test_con_la_identidad_ya_vinculada_se_entra_aunque_el_correo_del_token_no_este_verificado(): void
    {
        foreach ($this->providers() as $provider) {
            $account = $this->makeAccount(self::APP);
            $link = new {{ app.model }}SocialIdentity(['provider' => $provider, 'subject' => "sub-{$provider}-1", 'email' => $account->email, 'email_verified' => true]);
            $link->account_id = $account->getKey();
            $link->save();

            // El correo del token ya no coincide ni está verificado: manda la identidad, no el correo.
            $over = ['email' => 'otro@example.com', 'email_verified' => $provider === 'microsoft' ? null : false];
            $this->loginWith($provider, $this->token($provider, $over))->assertOk()->assertJsonPath('data.email', $account->email);
            $link->delete();
        }
    }

    public function test_los_proveedores_publicos_son_solo_los_habilitados_y_configurados(): void
    {
        $res = $this->getJson('/api/' . self::APP . '/auth/social/providers')->assertOk();
        $names = array_column($res->json('data'), 'provider');

        $this->assertEqualsCanonicalizing(array_values(array_intersect($this->providers(), ['google', 'microsoft'])), $names);
        $this->assertStringNotContainsString('secret', strtolower($res->getContent()));
    }

    // ---- rechazado: el token -----------------------------------------------------------------------------------------

    public function test_una_firma_falsificada_se_rechaza(): void
    {
        foreach ($this->providers() as $provider) {
            $account = $this->makeAccount(self::APP);
            $forged = $this->token($provider, ['email' => $account->email], self::$attacker); // mismo kid, otra llave

            $this->loginWith($provider, $forged)->assertStatus(401);
        }
        $this->assertSame(0, $this->identities());
    }

    public function test_un_token_alg_none_se_rechaza(): void
    {
        foreach ($this->providers() as $provider) {
            $account = $this->makeAccount(self::APP);
            $header = $this->b64(json_encode(['alg' => 'none', 'typ' => 'JWT', 'kid' => 'test-kid']));
            $payload = $this->b64(json_encode($this->claims($provider, ['email' => $account->email])));

            $this->loginWith($provider, "{$header}.{$payload}.")->assertStatus(401);
        }
        $this->assertSame(0, $this->identities());
    }

    public function test_la_confusion_de_algoritmo_hs256_con_la_clave_publica_se_rechaza(): void
    {
        foreach ($this->providers() as $provider) {
            $account = $this->makeAccount(self::APP);
            // El atacante firma con HMAC usando como secreto algo que conoce (el modulo publico del JWKS).
            $forged = JWT::encode($this->claims($provider, ['email' => $account->email]), self::$trusted[1]['n'] . self::$trusted[1]['n'], 'HS256', 'test-kid');

            $this->loginWith($provider, $forged)->assertStatus(401);
        }
        $this->assertSame(0, $this->identities());
    }

    public function test_audiencia_emisor_o_expiracion_incorrectos_se_rechazan(): void
    {
        foreach ($this->providers() as $provider) {
            $account = $this->makeAccount(self::APP);
            foreach ([['aud' => 'otra-aplicacion'], ['iss' => 'https://evil.example.com'], ['exp' => time() - 3600, 'iat' => time() - 7200], ['exp' => null]] as $over) {
                $this->loginWith($provider, $this->token($provider, ['email' => $account->email] + $over))->assertStatus(401);
            }
        }
        $this->assertSame(0, $this->identities());
    }

    public function test_si_el_jwks_no_responde_falla_cerrado(): void
    {
        Cache::flush();
        Http::swap(new HttpFactory());
        Http::fake(['*' => Http::response('', 500)]);

        foreach ($this->providers() as $provider) {
            $this->loginWith($provider, $this->token($provider))->assertStatus(401);
        }
    }

    public function test_un_proveedor_desconocido_o_no_habilitado_se_rechaza_siempre(): void
    {
        $token = $this->token('google');

        foreach (['facebook', 'github', 'GOOGLE', 'google%2f..', 'providers'] as $name) {
            // 404 (no hay ruta) o 405 ("providers" solo existe como GET): en ningún caso se procesa.
            $this->assertContains($this->postJson('/api/' . self::APP . "/auth/social/{$name}", ['id_token' => $token])->status(), [404, 405], $name);
        }
        foreach (array_diff(['google', 'microsoft', 'apple'], $this->providers()) as $disabled) {
            $this->postJson('/api/' . self::APP . "/auth/social/{$disabled}", ['id_token' => $this->token($disabled)])->assertNotFound();
        }
        $this->assertSame(0, $this->identities());
    }

    public function test_un_token_que_no_es_jwt_o_va_vacio_se_rechaza_sin_decodificarlo(): void
    {
        foreach ($this->providers() as $provider) {
            $payload = $this->b64(json_encode($this->claims($provider)));
            foreach (['', 'abc', "x.{$payload}", "x.{$payload}.y.z", str_repeat('a', 9000)] as $bad) {
                $this->loginWith($provider, $bad)->assertStatus(in_array($bad, ['', str_repeat('a', 9000)], true) ? 422 : 401);
            }
        }
        $this->assertSame(0, $this->identities());
    }

    // ---- rechazado: la cuenta --------------------------------------------------------------------------------------

    public function test_un_correo_sin_verificar_no_enlaza_ni_crea_cuenta(): void
    {
        foreach ($this->providers() as $provider) {
            $account = $this->makeAccount(self::APP);
            $over = ['email' => $account->email, 'email_verified' => $provider === 'microsoft' ? null : false];

            $this->loginWith($provider, $this->token($provider, $over))->assertStatus(401);
        }
        $this->assertSame(0, $this->identities());
    }

    public function test_microsoft_no_enlaza_por_correo_aunque_el_token_sea_valido(): void
    {
        if (! in_array('microsoft', $this->providers(), true)) {
            $this->markTestSkipped('Microsoft no está habilitado en esta app.');
        }
        $account = $this->makeAccount(self::APP);

        $this->loginWith('microsoft', $this->token('microsoft', ['email' => $account->email, 'email_verified' => true]))->assertStatus(401);
        $this->assertSame(0, $this->identities());
    }

    public function test_el_correo_que_manda_el_cliente_no_es_la_identidad(): void
    {
        foreach ($this->providers() as $provider) {
            $victim = $this->makeAccount(self::APP);

            // El token es de otra persona; el cuerpo intenta hacerse pasar por la víctima.
            $this->loginWith($provider, $this->token($provider, ['sub' => 'sub-atacante', 'email' => 'atacante@example.com']), ['email' => $victim->email, 'user_id' => $victim->getKey()])->assertStatus(401);
        }
        $this->assertSame(0, $this->identities());
    }

    public function test_una_cuenta_inactiva_no_entra_ni_se_enlaza(): void
    {
        foreach ($this->providers() as $provider) {
            if (! $this->linksByEmail($provider)) {
                continue;
            }
            $inactive = $this->makeAccount(self::APP, ['active' => false]);

            $this->loginWith($provider, $this->token($provider, ['email' => $inactive->email]))->assertStatus(401);
        }
        $this->assertSame(0, $this->identities());
    }

    public function test_no_se_reasigna_por_correo_una_cuenta_ya_vinculada_a_otra_identidad_del_proveedor(): void
    {
        foreach ($this->providers() as $provider) {
            if (! $this->linksByEmail($provider)) {
                continue;
            }
            $account = $this->makeAccount(self::APP);
            $link = new {{ app.model }}SocialIdentity(['provider' => $provider, 'subject' => 'sub-original', 'email' => $account->email, 'email_verified' => true]);
            $link->account_id = $account->getKey();
            $link->save();

            // Otra identidad del mismo proveedor con el mismo correo verificado: no toma la cuenta.
            $this->loginWith($provider, $this->token($provider, ['sub' => 'sub-otra', 'email' => $account->email]))->assertStatus(401);
            $link->delete();
        }
    }

    // ---- aislamiento entre apps y guards ----------------------------------------------------------------------------

    public function test_una_identidad_vinculada_aqui_no_sirve_en_otra_app_y_su_token_se_rechaza_en_otros_guards(): void
    {
        $others = array_values(array_filter(array_keys($this->apps()), fn (string $k) => $k !== self::APP));
        if ($others === []) {
            $this->markTestSkipped('Hace falta otra app en el proyecto para probar el aislamiento.');
        }

        foreach ($this->providers() as $provider) {
            if (! $this->linksByEmail($provider)) {
                continue;
            }
            $account = $this->makeAccount(self::APP);
            $first = $this->loginWith($provider, $this->token($provider, ['email' => $account->email]))->assertOk();
            $bearer = ['Authorization' => 'Bearer ' . $first->json('data.access_token')];

            // Misma identidad (sub) sin correo verificable: aquí entra por el vínculo...
            $noEmail = $this->token($provider, ['email' => null]);
            $this->loginWith($provider, $noEmail)->assertOk();

            foreach ($others as $other) {
                // ...pero en otra app no hay vínculo: esa app no la conoce (404 si no tiene social, 401 si lo tiene).
                $res = $this->postJson("/api/{$other}/auth/social/{$provider}", ['id_token' => $noEmail]);
                $this->assertContains($res->status(), [401, 404], "la identidad de {$provider} no debe entrar en {$other}");

                // El token de esta app tampoco vale en los guards de las demás.
                $this->as($bearer)->getJson("/api/{$other}/profile")->assertUnauthorized();
                $this->as($bearer)->getJson("/api/{$other}/roles")->assertUnauthorized();
            }
        }
    }

    public function test_las_rutas_sociales_publicas_tienen_throttle(): void
    {
        $url = '/api/' . self::APP . '/auth/social/' . $this->providers()[0];
        for ($i = 0; $i < 10; $i++) {
            $this->postJson($url, ['id_token' => 'a.b.c'])->assertStatus(401);
        }
        $this->postJson($url, ['id_token' => 'a.b.c'])->assertStatus(429);
    }

    // ---- vincular ---------------------------------------------------------------------------------------------------

    public function test_vincular_exige_estar_autenticado_y_enlaza_a_la_cuenta_del_token(): void
    {
        foreach ($this->providers() as $provider) {
            $account = $this->makeAccount(self::APP);
            $url = '/api/' . self::APP . "/auth/social/{$provider}/link";
            $token = $this->token($provider, ['email' => 'cualquiera@example.com']);

            $this->flushHeaders(); // `as()` deja el Bearer en las cabeceras por defecto
            $this->app['auth']->forgetGuards();
            $this->postJson($url, ['id_token' => $token])->assertUnauthorized();

            $this->as($this->bearer($account))->postJson($url, ['id_token' => $token])->assertOk()->assertJsonPath('data.linked', true);
            $this->assertDatabaseHas('{{ app.table }}_social_identities', ['account_id' => $account->getKey(), 'provider' => $provider]);

            // Con la identidad vinculada, entra aunque el proveedor no garantice el correo (Microsoft incluido).
            $this->loginWith($provider, $this->token($provider, ['email' => null]))->assertOk()->assertJsonPath('data.email', $account->email);
        }
    }

    public function test_una_identidad_ya_vinculada_a_otra_cuenta_no_se_puede_vincular(): void
    {
        foreach ($this->providers() as $provider) {
            $owner = $this->makeAccount(self::APP);
            $intruder = $this->makeAccount(self::APP);
            $url = '/api/' . self::APP . "/auth/social/{$provider}/link";
            $token = $this->token($provider, ['sub' => 'sub-compartida']);

            $this->as($this->bearer($owner))->postJson($url, ['id_token' => $token])->assertOk();
            $this->as($this->bearer($intruder))->postJson($url, ['id_token' => $token])->assertStatus(409);

            $this->assertDatabaseMissing('{{ app.table }}_social_identities', ['account_id' => $intruder->getKey()]);
        }
    }

    // ---- registros --------------------------------------------------------------------------------------------------

    public function test_un_rechazo_registra_proveedor_y_clase_pero_nunca_el_token(): void
    {
        Log::spy();
        $provider = $this->providers()[0];
        $forged = $this->token($provider, [], self::$attacker);

        $this->loginWith($provider, $forged)->assertStatus(401);

        Log::shouldHaveReceived('warning')->withArgs(function (string $message, array $context = []) use ($forged) {
            $dump = $message . json_encode($context);

            return ! str_contains($dump, $forged) && ! str_contains($dump, explode('.', $forged)[1]);
        })->once();
    }

{{#if app.auto_register}}
    public function test_con_auto_register_un_correo_verificado_sin_cuenta_crea_la_cuenta(): void
    {
        foreach ($this->providers() as $provider) {
            if (! $this->linksByEmail($provider)) {
                continue;
            }
            $email = "nuevo-{$provider}@example.com";

            $this->loginWith($provider, $this->token($provider, ['email' => $email]))->assertOk()->assertJsonPath('data.email', $email);

            $created = {{ app.model }}::query()->where('email', $email)->first();
            $this->assertNotNull($created);
            $this->assertSame(0, $created->roles()->count(), 'una cuenta nueva no recibe roles');
        }
    }
{{/if}}
{{#if !app.auto_register}}
    public function test_sin_auto_register_un_correo_verificado_sin_cuenta_no_crea_nada(): void
    {
        foreach ($this->providers() as $provider) {
            $before = {{ app.model }}::query()->count();

            $this->loginWith($provider, $this->token($provider, ['email' => "nuevo-{$provider}@example.com"]))->assertStatus(401);

            $this->assertSame($before, {{ app.model }}::query()->count());
        }
        $this->assertSame(0, $this->identities());
    }
{{/if}}
}
