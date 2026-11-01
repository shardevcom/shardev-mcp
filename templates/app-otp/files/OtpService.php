<?php

namespace App\Auth\Otp;

use {{ app.model_class }};
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use RuntimeException;
use Shardevcom\Authentications\Http\Resources\AccountResource;
use Shardevcom\Supports\Exceptions\UserFacingException;
use Shardevcom\Verification\Contracts\VerificationChannelInterface;
use Shardevcom\Verification\Exceptions\ChallengeNotFoundException;
use Shardevcom\Verification\Exceptions\ResendCooldownActiveException;
use Shardevcom\Verification\Exceptions\VerificationException;
use Shardevcom\Verification\Models\VerificationChallenge;
use Shardevcom\Verification\Repositories\VerificationChallengeRepository;
use Shardevcom\Verification\Services\VerificationManager;
use Throwable;

/**
 * Login sin contraseña de la app `{{ app.key }}`. NO es otra implementación de OTP: los códigos (hash,
 * caducidad, intentos máximos, enfriamiento) los gestiona `VerificationManager`, del paquete `verification`.
 * Este servicio solo es su canal de correo, decide qué cuentas pueden pedir código y emite el token.
 *
 * Reglas que NO se negocian aquí:
 *  - el código jamás se registra, se devuelve ni se pone en una cola;
 *  - pedir un código responde lo mismo exista o no la cuenta (ver el controlador);
 *  - el propósito del desafío lleva la app (`login:{{ app.key }}`): un código de otra app no sirve;
 *  - un código se canjea una sola vez, también bajo concurrencia;
 *  - una cuenta nueva solo se crea si el spec lo pidió (`auto_register`).
 */
class {{ app.model }}OtpService implements VerificationChannelInterface
{
    private const APP = '{{ app.key }}';

    private static ?string $dummyHash = null;

    public function channel(): string
    {
        return 'email';
    }

    /** Canal de `verification`: envía el correo. Síncrono a propósito (una cola guardaría el código en claro). */
    public function send(VerificationChallenge $challenge, string $code): void
    {
        // El mailer `log` escribe el mensaje ENTERO (con el código) en el log: solo vale en desarrollo.
        if (app()->isProduction() && in_array(config('mail.default'), ['log', 'array'], true)) {
            throw new RuntimeException('MAIL_MAILER no envía correo real; el código no se emite.');
        }

        Mail::to($challenge->recipient)->send(new {{ app.model }}LoginCodeMail($code, (int) config('verification.ttl', 10)));
    }

    /**
     * Pide un código. Nunca lanza por motivos de negocio (cuenta inexistente, inactiva, enfriamiento, tope
     * por hora): en todos esos casos simplemente no envía nada.
     */
    public function requestCode(string $email): void
    {
        $email = $this->normalize($email);
        $limiter = 'otp-request:' . self::APP . ':' . sha1($email);

        if (RateLimiter::tooManyAttempts($limiter, (int) config('otp_{{ app.key }}.max_requests_per_hour'))) {
            return;
        }
        RateLimiter::hit($limiter, 3600);

        $account = $this->findAccount($email);
        if ($account === null ? ! $this->autoRegister() : ! $account->active) {
            return;
        }

        try {
            $this->manager()->request([
                'channel' => 'email',
                'recipient' => $email,
                'purpose' => $this->purpose(),
                'context' => ['app' => self::APP],
            ]);
        } catch (ResendCooldownActiveException) {
            // Ya hay un código vigente enviado hace poco: se calla, la respuesta al cliente es la misma.
        } catch (Throwable $e) {
            // Solo la clase: el mensaje de un fallo de transporte puede traer destinatario o contenido.
            Log::warning('OTP: no se pudo emitir el código.', ['app' => self::APP, 'error' => $e::class]);
        }
    }

    /**
     * Canjea un código y devuelve el perfil con su token. Cualquier fallo (código malo, caducado, agotado,
     * ya usado, sin desafío, cuenta ausente o inactiva) es el mismo 401.
     *
     * @return array<string, mixed>
     */
    public function verifyCode(string $email, string $code): array
    {
        $email = $this->normalize($email);
        $limiter = 'otp-verify:' . self::APP . ':' . sha1($email);

        if (RateLimiter::tooManyAttempts($limiter, (int) config('otp_{{ app.key }}.verify_attempts'))) {
            throw new UserFacingException('Too many attempts. Try again later.', 429);
        }
        RateLimiter::hit($limiter, (int) config('otp_{{ app.key }}.verify_window_minutes') * 60);

        try {
            $challenge = $this->manager()->verify([
                'channel' => 'email',
                'recipient' => $email,
                'purpose' => $this->purpose(),
                'code' => trim($code),
            ]);
        } catch (VerificationException $e) {
            if ($e instanceof ChallengeNotFoundException) {
                // Sin desafío no hay hash que comprobar: se gasta el mismo tiempo para no distinguir "no existe".
                Hash::check($code, self::$dummyHash ??= Hash::make(Str::random(32)));
            }

            throw $this->invalid();
        }

        // Un solo uso, también si dos peticiones llegaron a la vez con el código bueno: solo una invalida la fila.
        $consumed = VerificationChallenge::query()
            ->whereKey($challenge->getKey())
            ->whereNull('invalidated_at')
            ->update(['invalidated_at' => now(), 'invalid_reason' => 'consumed_by_login', 'updated_at' => now()]);
        if ($consumed !== 1) {
            throw $this->invalid();
        }

        $account = $this->findAccount($email);
        if ($account === null) {
            if (! $this->autoRegister()) {
                throw $this->invalid();
            }
            $account = $this->register($email);
        }
        if (! $account->active) {
            throw $this->invalid();
        }

        RateLimiter::clear($limiter);

        return AccountResource::withToken($account, config('authentications.tokens.name', 'Personal Access Token') . ' (' . self::APP . ')');
    }

    private function manager(): VerificationManager
    {
        return new VerificationManager(app(VerificationChallengeRepository::class), $this);
    }

    private function purpose(): string
    {
        return (string) config('otp_{{ app.key }}.purpose');
    }

    private function autoRegister(): bool
    {
        return (bool) config('otp_{{ app.key }}.auto_register');
    }

    private function normalize(string $email): string
    {
        return Str::lower(trim($email));
    }

    private function findAccount(string $email): ?{{ app.model }}
    {
        return {{ app.model }}::query()->whereRaw('lower(email) = ?', [$email])->first();
    }

    /** Cuenta nueva (solo con auto_register): sin contraseña utilizable y sin roles; el dueño decide el rol por defecto. */
    private function register(string $email): {{ app.model }}
    {
        try {
            return DB::transaction(function () use ($email) {
                $account = {{ app.model }}::create([
                    'name' => Str::before($email, '@'),
                    'email' => $email,
                    'password' => Str::random(64), // aleatoria y nunca revelada: el modelo la guarda hasheada
                    'active' => true,
                ]);
                $account->forceFill(['email_verified_at' => now()])->save();

                return $account;
            });
        } catch (UniqueConstraintViolationException) {
            // Otra petición la creó a la vez: se usa esa.
            return $this->findAccount($email) ?? throw $this->invalid();
        }
    }

    private function invalid(): UserFacingException
    {
        return new UserFacingException('Invalid or expired code.', 401);
    }
}
