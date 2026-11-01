<?php

namespace Tests\Feature;

use {{ app.model_class }};
use {{ app.otp_mail_class }};
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Route;
use Shardevcom\Verification\Repositories\VerificationChallengeRepository;
use Tests\Feature\Concerns\AuthApps;
use Tests\TestCase;

/**
 * Login por código (OTP) de la app `{{ app.key }}`. Cada caso permitido tiene su caso rechazado.
 * El código se lee del correo simulado (Mail::fake): nunca viaja en la respuesta ni se registra.
 */
class {{ app.model }}OtpLoginTest extends TestCase
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

    private function url(string $path): string
    {
        return '/api/' . self::APP . '/auth/otp/' . $path;
    }

    /** Pide un código y lo devuelve, leído del correo. null si no se envió correo. */
    private function requestCode(string $email): ?string
    {
        $this->postJson($this->url('request'), ['email' => $email])->assertStatus(202);

        $code = null;
        Mail::assertSent({{ app.model }}LoginCodeMail::class, function ($mail) use (&$code, $email) {
            if ($mail->hasTo(strtolower($email))) {
                $code = $mail->code;
            }

            return true;
        });

        return $code;
    }

    private function verify(string $email, string $code)
    {
        return $this->postJson($this->url('verify'), ['email' => $email, 'code' => $code]);
    }

    private function wrongCode(string $code): string
    {
        return $code === '000000' ? '111111' : '000000';
    }

    public function test_el_codigo_correcto_inicia_sesion_y_el_token_sirve(): void
    {
        $account = $this->makeAccount(self::APP);
        $code = $this->requestCode($account->email);
        $this->assertNotNull($code);

        $res = $this->verify($account->email, $code)->assertOk();
        $res->assertJsonPath('data.email', $account->email);
        $token = $res->json('data.access_token');
        $this->assertNotEmpty($token);
        $this->assertArrayNotHasKey('password', $res->json('data'));

        $this->as(['Authorization' => "Bearer {$token}"])->getJson('/api/' . self::APP . '/profile')->assertOk();
    }

    public function test_el_correo_no_distingue_mayusculas(): void
    {
        $account = $this->makeAccount(self::APP);
        $code = $this->requestCode(strtoupper($account->email));
        $this->assertNotNull($code);

        $this->verify(strtoupper($account->email), $code)->assertOk();
    }

    public function test_un_codigo_incorrecto_se_rechaza(): void
    {
        $account = $this->makeAccount(self::APP);
        $code = $this->requestCode($account->email);

        $this->verify($account->email, $this->wrongCode($code))->assertStatus(401);
        // y el bueno sigue valiendo: un fallo suelto no quema el código
        $this->verify($account->email, $code)->assertOk();
    }

    public function test_el_codigo_se_guarda_hasheado_y_nunca_viaja_en_la_respuesta(): void
    {
        $account = $this->makeAccount(self::APP);
        $res = $this->postJson($this->url('request'), ['email' => $account->email])->assertStatus(202);
        $code = null;
        Mail::assertSent({{ app.model }}LoginCodeMail::class, function ($mail) use (&$code) {
            $code = $mail->code;

            return true;
        });

        $this->assertStringNotContainsString($code, $res->getContent());
        $row = DB::table('verification_challenges')->where('recipient', strtolower($account->email))->first();
        $this->assertNotNull($row);
        $this->assertNotSame($code, $row->code_hash);
        $this->assertTrue(Hash::check($code, $row->code_hash));
        $this->assertStringNotContainsString($code, json_encode($row));
    }

    public function test_se_bloquea_tras_los_intentos_maximos_aunque_luego_llegue_el_codigo_bueno(): void
    {
        $account = $this->makeAccount(self::APP);
        $code = $this->requestCode($account->email);
        $max = (int) config('verification.attempts.max');

        for ($i = 0; $i < $max; $i++) {
            $this->verify($account->email, $this->wrongCode($code))->assertStatus(401);
        }

        $this->verify($account->email, $code)->assertStatus(401);
    }

    public function test_un_codigo_caducado_se_rechaza(): void
    {
        $account = $this->makeAccount(self::APP);
        $code = $this->requestCode($account->email);

        $this->travel((int) config('verification.ttl') + 1)->minutes();

        $this->verify($account->email, $code)->assertStatus(401);
    }

    public function test_un_codigo_se_canjea_una_sola_vez(): void
    {
        $account = $this->makeAccount(self::APP);
        $code = $this->requestCode($account->email);

        $this->verify($account->email, $code)->assertOk();
        $this->verify($account->email, $code)->assertStatus(401);
    }

    public function test_pedir_un_codigo_responde_igual_exista_o_no_la_cuenta(): void
    {
        $known = $this->makeAccount(self::APP);
        $inactive = $this->makeAccount(self::APP, ['active' => false]);

        $a = $this->postJson($this->url('request'), ['email' => $known->email]);
        $b = $this->postJson($this->url('request'), ['email' => 'nadie-' . uniqid() . '@example.com']);
        $c = $this->postJson($this->url('request'), ['email' => $inactive->email]);

        foreach ([$a, $b, $c] as $r) {
            $r->assertStatus(202);
        }
        $this->assertSame($a->json(), $b->json());
        $this->assertSame($a->json(), $c->json());

        // Solo la cuenta activa recibe correo.
        Mail::assertSent({{ app.model }}LoginCodeMail::class, 1);
        Mail::assertSent({{ app.model }}LoginCodeMail::class, fn ($m) => $m->hasTo($known->email));
    }

    public function test_pedir_otra_vez_dentro_del_enfriamiento_responde_igual_y_no_reenvia(): void
    {
        $account = $this->makeAccount(self::APP);
        $first = $this->postJson($this->url('request'), ['email' => $account->email]);
        $second = $this->postJson($this->url('request'), ['email' => $account->email]);

        $this->assertSame($first->status(), $second->status());
        $this->assertSame($first->json(), $second->json());
        Mail::assertSent({{ app.model }}LoginCodeMail::class, 1);
    }

    public function test_verificar_un_correo_sin_cuenta_da_la_misma_respuesta_que_un_codigo_malo(): void
    {
        $account = $this->makeAccount(self::APP);
        $code = $this->requestCode($account->email);

        $bad = $this->verify($account->email, $this->wrongCode($code));
        $none = $this->verify('nadie-' . uniqid() . '@example.com', '123456');

        $bad->assertStatus(401);
        $none->assertStatus(401);
        $this->assertSame($bad->json(), $none->json());
    }

    public function test_un_codigo_de_otra_app_no_sirve_aqui(): void
    {
        $account = $this->makeAccount(self::APP);

        // Un desafío vigente para el MISMO correo pero con el propósito de otra app.
        app(VerificationChallengeRepository::class)->insert([
            'channel' => 'email',
            'purpose' => 'login:otra-app',
            'recipient' => strtolower($account->email),
            'code_hash' => Hash::make('654321'),
            'attempts' => 0,
            'max_attempts' => 5,
            'expires_at' => now()->addMinutes(10),
        ]);

        $this->verify($account->email, '654321')->assertStatus(401);

        // Y al revés: el código de ESTA app no inicia sesión en otra app que también entre por código.
        $code = $this->requestCode($account->email);
        foreach (array_keys($this->apps()) as $other) {
            if ($other !== self::APP && Route::has("{$other}.otp.verify")) {
                $this->postJson("/api/{$other}/auth/otp/verify", ['email' => $account->email, 'code' => $code])->assertStatus(401);
            }
        }
        $this->verify($account->email, $code)->assertOk();
    }

    public function test_las_rutas_de_codigo_tienen_throttle(): void
    {
        for ($i = 0; $i < 6; $i++) {
            $this->postJson($this->url('request'), ['email' => "t{$i}@example.com"])->assertStatus(202);
        }
        $this->postJson($this->url('request'), ['email' => 't7@example.com'])->assertStatus(429);

        for ($i = 0; $i < 10; $i++) {
            $this->verify('v@example.com', '123456')->assertStatus(401);
        }
        $this->verify('v@example.com', '123456')->assertStatus(429);
    }

    public function test_la_app_no_tiene_login_por_contrasena(): void
    {
        $account = $this->makeAccount(self::APP);

        $this->assertFalse(Route::has(self::APP . '.signin'));
        $this->assertFalse(Route::has(self::APP . '.change-password'));
        $this->postJson('/api/' . self::APP . '/auth/signin', ['email' => $account->email, 'password' => self::TEST_PASSWORD])->assertNotFound();
        $this->as($this->bearer($account))->postJson('/api/' . self::APP . '/auth/change-password', ['current_password' => self::TEST_PASSWORD, 'new_password' => 'una-clave-larga-1'])->assertNotFound(); // shardev-allow-secret: dato de prueba
    }

    public function test_un_exito_no_deja_el_codigo_en_los_logs(): void
    {
        Log::spy();
        $account = $this->makeAccount(self::APP);
        $code = $this->requestCode($account->email);
        $this->verify($account->email, $code)->assertOk();

        foreach (['info', 'warning', 'error', 'debug', 'notice'] as $level) {
            Log::shouldNotHaveReceived($level);
        }
    }

{{#if app.auto_register}}
    public function test_con_auto_register_un_correo_nuevo_crea_la_cuenta_al_canjear_el_codigo(): void
    {
        $email = 'nuevo-' . uniqid() . '@example.com';
        $code = $this->requestCode($email);
        $this->assertNotNull($code);
        $this->assertSame(0, {{ app.model }}::query()->where('email', $email)->count());

        $this->verify($email, $code)->assertOk();

        $created = {{ app.model }}::query()->where('email', $email)->first();
        $this->assertNotNull($created);
        $this->assertSame(0, $created->roles()->count(), 'una cuenta nueva no recibe roles');
        $this->assertNull($this->postJson('/api/' . self::APP . '/auth/signin', ['email' => $email, 'password' => 'x'])->json('data.access_token'));
    }
{{/if}}
{{#if !app.auto_register}}
    public function test_sin_auto_register_un_correo_nuevo_no_recibe_codigo_ni_crea_cuenta(): void
    {
        $email = 'nuevo-' . uniqid() . '@example.com';

        $this->postJson($this->url('request'), ['email' => $email])->assertStatus(202);
        Mail::assertNothingSent();

        // Aunque alguien tuviera un desafío vigente para ese correo, el canje no crea la cuenta.
        app(VerificationChallengeRepository::class)->insert([
            'channel' => 'email',
            'purpose' => (string) config('otp_{{ app.key }}.purpose'),
            'recipient' => $email,
            'code_hash' => Hash::make('654321'),
            'attempts' => 0,
            'max_attempts' => 5,
            'expires_at' => now()->addMinutes(10),
        ]);
        $this->verify($email, '654321')->assertStatus(401);
        $this->assertSame(0, {{ app.model }}::query()->where('email', $email)->count());
    }
{{/if}}
}
