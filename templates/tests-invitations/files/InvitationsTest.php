<?php

namespace Tests\Feature;

use {{ app.model_class }};
use {{ app.invitation_mail_class }};
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Route;
use Shardevcom\Authentications\Models\Account;
use Tests\Feature\Concerns\AuthApps;
use Tests\TestCase;

/**
 * Alta por invitación de la app `{{ app.key }}`. Cada caso permitido tiene su caso rechazado. El token se lee del
 * correo simulado (Mail::fake): nunca viaja en una respuesta de la API ni se registra.
 */
class {{ app.model }}InvitationsTest extends TestCase
{
    use AuthApps;
    use RefreshDatabase;

    private const APP = '{{ app.key }}';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAuthApps();
        Mail::fake();
    }

    private function url(string $path = ''): string
    {
        return '/api/' . self::APP . ($path === '' ? '/invitations' : '/' . $path);
    }

    private function admin(): {{ app.model }}
    {
        return $this->makeAccount(self::APP, [], 'admin');
    }

    private function email(): string
    {
        return 'nuevo-' . uniqid() . '@example.com';
    }

    private function invite(Account $by, string $email)
    {
        return $this->as($this->bearer($by))->postJson($this->url(), ['email' => $email]);
    }

    /** El token de la última invitación enviada a ese correo, leído del enlace del correo. */
    private function sentToken(string $email): ?string
    {
        $token = null;
        Mail::assertSent({{ app.model }}InvitationMail::class, function ($mail) use (&$token, $email) {
            if ($mail->hasTo(strtolower($email))) {
                $token = substr($mail->url, strpos($mail->url, '#token=') + 7);
            }

            return true;
        });

        return $token;
    }

    private function accept(string $token, array $extra = [])
    {
        return $this->postJson($this->url('auth/invitations/accept'), array_merge([
            'token' => $token,
            'name' => 'Persona Invitada',
{{#if !app.feature.otp}}
            'password' => 'una-clave-larga-1', // shardev-allow-secret: dato de prueba
{{/if}}
        ], $extra));
    }

    public function test_un_administrador_con_permiso_invita_y_el_enlace_lleva_el_token_en_el_fragmento(): void
    {
        $email = $this->email();

        $res = $this->invite($this->admin(), $email)->assertStatus(202);

        $token = $this->sentToken($email);
        $this->assertNotEmpty($token);
        $this->assertGreaterThanOrEqual(43, strlen($token));
        $this->assertStringNotContainsString($token, $res->getContent());
        Mail::assertSent({{ app.model }}InvitationMail::class, fn ($m) => str_contains($m->url, '/' . self::APP . '/auth/accept-invitation#token=') && ! str_contains($m->url, '?'));
    }

    public function test_sin_el_permiso_o_sin_sesion_no_se_puede_invitar_listar_ni_revocar(): void
    {
        $email = $this->email();
        $user = $this->makeAccount(self::APP, [], 'user');
        $norole = $this->makeAccount(self::APP);

        foreach ([$user, $norole] as $who) {
            $this->invite($who, $email)->assertStatus(403);
            $this->as($this->bearer($who))->getJson($this->url())->assertStatus(403);
            $this->as($this->bearer($who))->deleteJson($this->url('invitations/1'))->assertStatus(403);
        }
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();
        $this->postJson($this->url(), ['email' => $email])->assertUnauthorized();
        $this->getJson($this->url())->assertUnauthorized();

        Mail::assertNothingSent();
        $this->assertSame(0, DB::table('{{ app.table }}_invitations')->count());
    }

    public function test_el_permiso_se_comprueba_por_accion(): void
    {
        // Solo `list:invitations`: puede listar, no invitar ni revocar.
        $guard = '{{ app.api_guard }}';
        $role = \Spatie\Permission\Models\Role::firstOrCreate(['name' => 'lector', 'guard_name' => $guard]);
        $role->givePermissionTo(\Spatie\Permission\Models\Permission::firstOrCreate(['name' => 'list:invitations', 'guard_name' => $guard]));
        $reader = $this->makeAccount(self::APP, [], 'lector');

        $this->as($this->bearer($reader))->getJson($this->url())->assertOk();
        $this->invite($reader, $this->email())->assertStatus(403);
        $this->as($this->bearer($reader))->deleteJson($this->url('invitations/1'))->assertStatus(403);
    }

    public function test_un_token_de_otra_app_no_sirve_para_invitar(): void
    {
        foreach (array_keys($this->apps()) as $other) {
            if ($other === self::APP) {
                continue;
            }
            $foreign = $this->makeAccount($other, [], 'admin');
            $this->invite($foreign, $this->email())->assertUnauthorized();
            $this->as($this->bearer($foreign))->getJson($this->url())->assertUnauthorized();
        }

        Mail::assertNothingSent();
    }

    public function test_quien_invita_sale_del_token_y_no_de_la_entrada(): void
    {
        $admin = $this->admin();
        $other = $this->admin();
        $email = $this->email();

        $this->as($this->bearer($admin))->postJson($this->url(), [
            'email' => $email,
            'inviter_id' => $other->getKey(),
            'inviter' => $other->getKey(),
            'token_hash' => str_repeat('a', 64),
            'expires_at' => now()->addYears(10)->toDateTimeString(),
            'accepted_at' => now()->toDateTimeString(),
        ])->assertStatus(202);

        $row = DB::table('{{ app.table }}_invitations')->where('email', strtolower($email))->first();
        $this->assertSame($admin->getKey(), (int) $row->inviter_id);
        $this->assertNotSame(str_repeat('a', 64), $row->token_hash);
        $this->assertNull($row->accepted_at);
        $this->assertTrue(\Illuminate\Support\Carbon::parse($row->expires_at)->lt(now()->addDays((int) config('invitations_{{ app.key }}.ttl_days') + 1)));
    }

    public function test_el_token_se_guarda_solo_como_sha256_y_no_aparece_en_ninguna_columna(): void
    {
        $email = $this->email();
        $this->invite($this->admin(), $email)->assertStatus(202);
        $token = $this->sentToken($email);

        $row = DB::table('{{ app.table }}_invitations')->where('email', strtolower($email))->first();
        $this->assertSame(hash('sha256', $token), $row->token_hash);
        $this->assertStringNotContainsString($token, json_encode(DB::table('{{ app.table }}_invitations')->get()));
    }

    public function test_aceptar_crea_la_cuenta_verificada_sin_roles_ni_token_y_con_el_correo_de_la_invitacion(): void
    {
        $email = $this->email();
        $this->invite($this->admin(), $email)->assertStatus(202);
        $token = $this->sentToken($email);

        // Un `email` o un `roles` en la entrada no cuentan: la cuenta es la del correo invitado y no tiene roles.
        $res = $this->accept($token, ['email' => 'otro@example.com', 'roles' => ['admin'], 'active' => false])->assertStatus(201);

        $this->assertNull($res->json('data.access_token'));
        $this->assertStringNotContainsString('access_token', $res->getContent());
        $account = {{ app.model }}::query()->where('email', strtolower($email))->first();
        $this->assertNotNull($account);
        $this->assertNotNull($account->email_verified_at);
        $this->assertTrue($account->active);
        $this->assertSame(0, $account->roles()->count());
        $this->assertSame(0, {{ app.model }}::query()->where('email', 'otro@example.com')->count());
{{#if !app.feature.otp}}

        $this->postJson('/api/' . self::APP . '/auth/signin', ['email' => $email, 'password' => 'una-clave-larga-1'])->assertOk(); // shardev-allow-secret: dato de prueba
{{/if}}
{{#if app.feature.otp}}

        // App sin contraseña: la cuenta guarda un hash aleatorio y esta app no tiene login por contraseña.
        $this->assertFalse(Route::has(self::APP . '.signin'));
{{/if}}
    }

    public function test_una_invitacion_se_canjea_una_sola_vez(): void
    {
        $email = $this->email();
        $this->invite($this->admin(), $email)->assertStatus(202);
        $token = $this->sentToken($email);

        $this->accept($token)->assertStatus(201);
        $second = $this->accept($token)->assertStatus(422);

        $this->assertSame(1, {{ app.model }}::query()->where('email', strtolower($email))->count());
        $this->assertNotNull($second->json('message'));
    }

    public function test_invalida_caducada_usada_y_revocada_dan_la_misma_respuesta(): void
    {
        $admin = $this->admin();

        $expired = $this->email();
        $this->invite($admin, $expired)->assertStatus(202);
        $expiredToken = $this->sentToken($expired);
        $this->travel((int) config('invitations_{{ app.key }}.ttl_days') + 1)->days();
        $a = $this->accept($expiredToken)->assertStatus(422);
        $this->travelBack();

        $used = $this->email();
        $this->invite($admin, $used)->assertStatus(202);
        $usedToken = $this->sentToken($used);
        $this->accept($usedToken)->assertStatus(201);
        $b = $this->accept($usedToken)->assertStatus(422);

        $revoked = $this->email();
        $this->invite($admin, $revoked)->assertStatus(202);
        $revokedToken = $this->sentToken($revoked);
        $id = DB::table('{{ app.table }}_invitations')->where('email', strtolower($revoked))->value('id');
        $this->as($this->bearer($admin))->deleteJson($this->url("invitations/{$id}"))->assertOk();
        $c = $this->accept($revokedToken)->assertStatus(422);

        $d = $this->accept(str_repeat('z', 43))->assertStatus(422);

        foreach ([$b, $c, $d] as $r) {
            $this->assertSame($a->json(), $r->json());
        }
        $this->assertSame(0, {{ app.model }}::query()->whereIn('email', [strtolower($expired), strtolower($revoked)])->count());
    }

    public function test_una_invitacion_de_otra_app_no_se_acepta_aqui_ni_al_reves(): void
    {
        $email = $this->email();
        $this->invite($this->admin(), $email)->assertStatus(202);
        $token = $this->sentToken($email);

        foreach (array_keys($this->apps()) as $other) {
            if ($other !== self::APP && Route::has("{$other}.invitations.accept")) {
                $this->postJson("/api/{$other}/auth/invitations/accept", ['token' => $token, 'name' => 'X', 'password' => 'una-clave-larga-1'])->assertStatus(422); // shardev-allow-secret: dato de prueba
            }
        }

        // Vive en la tabla de ESTA app y no se quemó por intentarlo en otra.
        $this->assertSame(1, DB::table('{{ app.table }}_invitations')->where('token_hash', hash('sha256', $token))->count());
        $this->accept($token)->assertStatus(201);
    }

    public function test_invitar_responde_igual_exista_o_no_la_cuenta_y_a_una_existente_no_le_envia_nada(): void
    {
        $admin = $this->admin();
        $existing = $this->makeAccount(self::APP);

        $a = $this->invite($admin, $existing->email);
        $b = $this->invite($admin, $this->email());
        $c = $this->invite($admin, strtoupper($existing->email));

        foreach ([$a, $b, $c] as $r) {
            $r->assertStatus(202);
        }
        $this->assertSame($a->json(), $b->json());
        $this->assertSame($a->json(), $c->json());
        Mail::assertSent({{ app.model }}InvitationMail::class, 1);
        Mail::assertNotSent({{ app.model }}InvitationMail::class, fn ($m) => $m->hasTo($existing->email));
        $this->assertSame(0, DB::table('{{ app.table }}_invitations')->where('email', strtolower($existing->email))->count());
    }

    public function test_aceptar_con_un_correo_que_ya_tiene_cuenta_falla_y_no_consume_la_invitacion(): void
    {
        $email = $this->email();
        $this->invite($this->admin(), $email)->assertStatus(202);
        $token = $this->sentToken($email);
        // La cuenta aparece por otro camino entre la invitación y su aceptación.
        $this->makeAccount(self::APP, ['email' => $email]);

        $this->accept($token)->assertStatus(422);

        $this->assertNull(DB::table('{{ app.table }}_invitations')->where('email', strtolower($email))->value('accepted_at'));
    }

    public function test_reinvitar_revoca_la_anterior(): void
    {
        $admin = $this->admin();
        $email = $this->email();

        $this->invite($admin, $email)->assertStatus(202);
        $first = $this->sentToken($email);
        $this->invite($admin, $email)->assertStatus(202);
        $second = $this->sentToken($email);

        $this->assertNotSame($first, $second);
        $this->accept($first)->assertStatus(422);
        $this->accept($second)->assertStatus(201);
    }

    public function test_el_listado_no_expone_tokens_y_la_revocacion_pide_permiso_y_existencia(): void
    {
        $admin = $this->admin();
        $email = $this->email();
        $this->invite($admin, $email)->assertStatus(202);
        $token = $this->sentToken($email);

        $list = $this->as($this->bearer($admin))->getJson($this->url())->assertOk();
        $this->assertSame(strtolower($email), $list->json('data.0.email'));
        $this->assertSame('pending', $list->json('data.0.status'));
        $this->assertStringNotContainsString($token, $list->getContent());
        $this->assertStringNotContainsString('token_hash', $list->getContent());
        $this->assertStringNotContainsString(hash('sha256', $token), $list->getContent());

        $this->as($this->bearer($admin))->deleteJson($this->url('invitations/999999'))->assertStatus(404);
        $id = $list->json('data.0.id');
        $this->as($this->bearer($admin))->deleteJson($this->url("invitations/{$id}"))->assertOk();
        $this->as($this->bearer($admin))->deleteJson($this->url("invitations/{$id}"))->assertStatus(404);
        $this->as($this->bearer($admin))->getJson($this->url())->assertJsonPath('data.0.status', 'revoked');
    }

{{#if !app.feature.otp}}
    public function test_la_contrasena_es_obligatoria_y_se_valida(): void
    {
        $email = $this->email();
        $this->invite($this->admin(), $email)->assertStatus(202);
        $token = $this->sentToken($email);

        $this->accept($token, ['password' => 'corta'])->assertStatus(422);
        $this->postJson($this->url('auth/invitations/accept'), ['token' => $token, 'name' => 'X'])->assertStatus(422);
        $this->assertSame(0, {{ app.model }}::query()->where('email', strtolower($email))->count());

        $this->accept($token)->assertStatus(201);
    }
{{/if}}
{{#if app.feature.otp}}
    public function test_en_una_app_sin_contrasena_se_acepta_sin_contrasena_y_la_que_llegue_se_ignora(): void
    {
        $email = $this->email();
        $this->invite($this->admin(), $email)->assertStatus(202);
        $token = $this->sentToken($email);

        $this->accept($token, ['password' => 'una-clave-larga-1'])->assertStatus(201); // shardev-allow-secret: dato de prueba

        $account = {{ app.model }}::query()->where('email', strtolower($email))->first();
        $this->assertNotNull($account);
        $this->assertFalse(\Illuminate\Support\Facades\Hash::check('una-clave-larga-1', $account->password)); // shardev-allow-secret: dato de prueba
    }
{{/if}}

    public function test_el_correo_no_es_encolable_y_no_hay_nada_en_la_cola(): void
    {
        Queue::fake();
        $this->assertNotInstanceOf(ShouldQueue::class, new {{ app.model }}InvitationMail('https://example.test/#token=x', 7));

        $email = $this->email();
        $this->invite($this->admin(), $email)->assertStatus(202);

        Queue::assertNothingPushed();
        $this->assertNotNull($this->sentToken($email));
    }

    public function test_en_produccion_con_un_mailer_que_no_entrega_no_se_invita(): void
    {
        $admin = $this->admin();
        $headers = $this->bearer($admin);
        $original = $this->app->environment();
        $this->app->detectEnvironment(fn () => 'production');
        config(['mail.default' => 'log']);

        try {
            $this->as($headers)->postJson($this->url(), ['email' => $this->email()])->assertStatus(503);
            config(['mail.default' => 'array']);
            $this->as($headers)->postJson($this->url(), ['email' => $this->email()])->assertStatus(503);
        } finally {
            $this->app->detectEnvironment(fn () => $original);
        }

        Mail::assertNothingSent();
        $this->assertSame(0, DB::table('{{ app.table }}_invitations')->count());
    }

    public function test_ni_el_token_ni_el_correo_quedan_en_los_logs(): void
    {
        Log::spy();
        $email = $this->email();
        $this->invite($this->admin(), $email)->assertStatus(202);
        $token = $this->sentToken($email);
        $this->accept($token)->assertStatus(201);
        $this->accept($token)->assertStatus(422);

        foreach (['info', 'warning', 'error', 'debug', 'notice', 'critical', 'alert', 'emergency'] as $level) {
            Log::shouldNotHaveReceived($level);
        }
    }

    public function test_aceptar_y_crear_tienen_throttle(): void
    {
        for ($i = 0; $i < 10; $i++) {
            $this->postJson($this->url('auth/invitations/accept'), ['token' => str_repeat('q', 43), 'name' => 'X', 'password' => 'una-clave-larga-1'])->assertStatus(422); // shardev-allow-secret: dato de prueba
        }
        $this->postJson($this->url('auth/invitations/accept'), ['token' => str_repeat('q', 43), 'name' => 'X', 'password' => 'una-clave-larga-1'])->assertStatus(429); // shardev-allow-secret: dato de prueba

        $headers = $this->bearer($this->admin());
        for ($i = 0; $i < 20; $i++) {
            $this->as($headers)->postJson($this->url(), ['email' => $this->email()])->assertStatus(202);
        }
        $this->as($headers)->postJson($this->url(), ['email' => $this->email()])->assertStatus(429);
    }

    public function test_la_app_no_tiene_registro_publico(): void
    {
        foreach (['auth/register', 'register', 'auth/signup', 'signup'] as $path) {
            $this->postJson("/api/" . self::APP . "/{$path}", ['email' => $this->email(), 'name' => 'X', 'password' => 'una-clave-larga-1'])->assertNotFound(); // shardev-allow-secret: dato de prueba
        }

        foreach (Route::getRoutes() as $route) {
            if (str_starts_with($route->uri(), 'api/' . self::APP . '/')) {
                $this->assertDoesNotMatchRegularExpression('/register|signup|sign-up/i', $route->uri());
            }
        }
    }

    public function test_el_comando_de_arranque_invita_sin_invitador_y_no_imprime_el_token(): void
    {
        $email = $this->email();

        $this->artisan(self::APP . ':invite', ['email' => $email])->assertSuccessful();

        $token = $this->sentToken($email);
        $row = DB::table('{{ app.table }}_invitations')->where('email', strtolower($email))->first();
        $this->assertNull($row->inviter_id);
        $this->assertSame(hash('sha256', $token), $row->token_hash);
        $this->accept($token)->assertStatus(201);
    }

    public function test_el_comando_no_envia_a_una_cuenta_existente_ni_a_un_correo_invalido(): void
    {
        $existing = $this->makeAccount(self::APP);

        $this->artisan(self::APP . ':invite', ['email' => $existing->email])->assertSuccessful();
        $this->artisan(self::APP . ':invite', ['email' => 'no-es-un-correo'])->assertFailed();

        Mail::assertNothingSent();
    }

    public function test_en_produccion_el_comando_pide_confirmacion_y_sin_ella_no_envia(): void
    {
        $email = $this->email();
        $original = $this->app->environment();
        $this->app->detectEnvironment(fn () => 'production');
        config(['mail.default' => 'smtp']);

        try {
            $this->artisan(self::APP . ':invite', ['email' => $email])
                ->expectsConfirmation("Estás en PRODUCCIÓN. ¿Enviar la invitación de la app " . self::APP . " a {$email}?", 'no')
                ->assertFailed();
        } finally {
            $this->app->detectEnvironment(fn () => $original);
        }

        Mail::assertNothingSent();
        $this->assertSame(0, DB::table('{{ app.table }}_invitations')->count());
    }

    public function test_en_produccion_el_comando_confirmado_envia_pero_no_con_un_mailer_que_no_entrega(): void
    {
        $original = $this->app->environment();
        $this->app->detectEnvironment(fn () => 'production');

        try {
            config(['mail.default' => 'log']);
            $this->artisan(self::APP . ':invite', ['email' => $this->email(), '--force' => true])->assertFailed();
            Mail::assertNothingSent();

            config(['mail.default' => 'smtp']);
            $this->artisan(self::APP . ':invite', ['email' => $this->email(), '--force' => true])->assertSuccessful();
            Mail::assertSent({{ app.model }}InvitationMail::class, 1);
        } finally {
            $this->app->detectEnvironment(fn () => $original);
        }
    }
}
