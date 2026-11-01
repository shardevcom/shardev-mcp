<?php

namespace App\Auth\Mfa;

use {{ app.model_class }};
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use PragmaRX\Google2FA\Google2FA;
use RuntimeException;
use Shardevcom\Authentications\Http\Resources\AccountResource;
use Shardevcom\Supports\Exceptions\UserFacingException;

/**
 * Segundo factor TOTP de la app `{{ app.key }}`. La criptografía de TOTP es de `pragmarx/google2fa`.
 *
 * Reglas que NO se negocian aquí:
 *  - una contraseña correcta de una cuenta con MFA NO devuelve token, solo un desafío opaco (aleatorio, guardado
 *    con sha256, de un solo uso, con tope de intentos y caducidad) ligado a esa cuenta y a esta app;
 *  - un paso TOTP aceptado no se puede reutilizar: `verifyKeyNewer` + un UPDATE condicional atómico;
 *  - el secreto se guarda cifrado y los códigos de recuperación hasheados, de un solo uso y se muestran una vez;
 *  - ni el código, ni el secreto, ni el desafío, ni los códigos de recuperación se registran jamás.
 */
class {{ app.model }}MfaService
{
    private const APP = '{{ app.key }}';

    private const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

    private static ?string $dummyHash = null;

    /**
     * Contraseña y, si la cuenta tiene MFA confirmado, desafío en lugar de token. Mismas respuestas de error y
     * mismo coste que el login de la clase base. Las cuentas sin MFA reciben la respuesta normal.
     *
     * @param  array{email: string, password: string}  $credentials
     * @return array<string, mixed>
     */
    public function signin(array $credentials): array
    {
        $account = {{ app.model }}::query()->where('email', $credentials['email'])->first();

        // Cuenta inexistente, contraseña errónea o cuenta inactiva: misma respuesta y mismo coste.
        $valid = Hash::check($credentials['password'], $account?->password ?? (self::$dummyHash ??= Hash::make(Str::random(32))));
        if (! $account || ! $valid || ! $account->active) {
            throw new UserFacingException('Invalid credentials.', 401);
        }

        if ($this->confirmed($account) !== null) {
            return $this->startChallenge($account);
        }

        return $this->issueToken($account);
    }

    /**
     * Canjea un desafío + un código (TOTP o de recuperación) por el token. Cualquier fallo (desafío inexistente,
     * caducado, usado, agotado, de otra app, cuenta inactiva, código malo, cuenta bloqueada) es el mismo 401.
     *
     * @return array<string, mixed>
     */
    public function verify(#[\SensitiveParameter] string $challengeValue, #[\SensitiveParameter] string $code): array
    {
        $challenge = {{ app.model }}MfaChallenge::query()->where('token_hash', hash('sha256', $challengeValue))->first();
        if ($challenge === null) {
            // Sin desafío no hay nada que comprobar: se gasta un coste parecido para no distinguir "no existe".
            Hash::check($code, self::$dummyHash ??= Hash::make(Str::random(32)));

            throw $this->invalidCode();
        }

        // Se reserva un intento ANTES de mirar el código y de forma atómica: dos peticiones simultáneas no pueden
        // gastar más intentos de los permitidos, y un desafío usado, caducado o agotado no reserva nada.
        $reserved = {{ app.model }}MfaChallenge::query()
            ->whereKey($challenge->getKey())
            ->whereNull('used_at')
            ->where('expires_at', '>', now())
            ->where('attempts', '<', (int) config('mfa_{{ app.key }}.challenge_max_attempts'))
            ->increment('attempts');
        if ($reserved !== 1) {
            throw $this->invalidCode();
        }

        $accountId = (int) $challenge->account_id;
        $limiter = $this->failureKey($accountId);
        if (RateLimiter::tooManyAttempts($limiter, $this->maxFailures())) {
            throw $this->invalidCode();
        }

        $account = {{ app.model }}::query()->find($accountId);
        $mfa = $account === null ? null : $this->confirmed($account);
        if ($account === null || ! $account->active || $mfa === null || ! $this->checkCode($mfa, $code)) {
            RateLimiter::hit($limiter, $this->failureWindow());

            throw $this->invalidCode();
        }

        // Un solo uso: si otra petición lo canjeó (o caducó) entre medias, esta falla.
        $consumed = {{ app.model }}MfaChallenge::query()
            ->whereKey($challenge->getKey())
            ->whereNull('used_at')
            ->where('expires_at', '>', now())
            ->update(['used_at' => now()]);
        if ($consumed !== 1) {
            throw $this->invalidCode();
        }

        RateLimiter::clear($limiter);

        return $this->issueToken($account);
    }

    /** @return array{enabled: bool, pending: bool, recovery_codes_remaining: int} */
    public function status({{ app.model }} $account): array
    {
        $mfa = {{ app.model }}Mfa::query()->where('account_id', $account->getKey())->first();
        $enabled = $mfa !== null && $mfa->confirmed_at !== null;

        return [
            'enabled' => $enabled,
            'pending' => $mfa !== null && ! $enabled,
            'recovery_codes_remaining' => $enabled ? count($mfa->recovery_codes ?? []) : 0,
        ];
    }

    /**
     * Alta, paso 1: genera un secreto PENDIENTE (no protege nada hasta que `confirm` lo valide). Se muestra al
     * usuario para su app autenticadora. Repetirlo reemplaza el pendiente anterior; con MFA ya activo se niega.
     *
     * @return array{secret: string, otpauth_url: string}
     */
    public function setup({{ app.model }} $account): array
    {
        try {
            return DB::transaction(function () use ($account) {
                $existing = {{ app.model }}Mfa::query()->where('account_id', $account->getKey())->lockForUpdate()->first();
                if ($existing !== null && $existing->confirmed_at !== null) {
                    throw new UserFacingException('Two-factor authentication is already enabled.', 409);
                }

                $secret = $this->totp()->generateSecretKey((int) config('mfa_{{ app.key }}.secret_length'));
                $row = $existing ?? new {{ app.model }}Mfa();
                $row->forceFill(['account_id' => $account->getKey()]);
                $row->fill(['secret' => $secret, 'confirmed_at' => null, 'last_used_step' => null, 'recovery_codes' => null]);
                $row->save();

                return ['secret' => $secret, 'otpauth_url' => $this->otpauthUrl($account, $secret)];
            });
        } catch (UniqueConstraintViolationException) {
            throw new UserFacingException('Two-factor setup is already in progress.', 409);
        }
    }

    /**
     * Alta, paso 2: un código TOTP válido del secreto pendiente lo activa. Devuelve los códigos de recuperación
     * (única vez que se ven) y cierra las demás sesiones de la cuenta.
     *
     * @return array{recovery_codes: list<string>}
     */
    public function confirm({{ app.model }} $account, #[\SensitiveParameter] string $code): array
    {
        $this->assertNotLocked($account);

        $mfa = {{ app.model }}Mfa::query()->where('account_id', $account->getKey())->whereNull('confirmed_at')->first();
        $step = $mfa === null ? false : $this->matchTotp($mfa, $code);
        if (! is_int($step)) {
            $this->recordFailure($account);

            throw new UserFacingException('Invalid code.', 422);
        }

        [$plain, $hashes] = $this->newRecoveryCodes();
        $activated = {{ app.model }}Mfa::query()
            ->whereKey($mfa->getKey())
            ->whereNull('confirmed_at')
            ->update(['confirmed_at' => now(), 'last_used_step' => $step, 'recovery_codes' => json_encode($hashes)]);
        if ($activated !== 1) {
            throw new UserFacingException('Invalid code.', 422);
        }

        RateLimiter::clear($this->failureKey((int) $account->getKey()));
        $this->revokeOtherTokens($account);

        return ['recovery_codes' => $plain];
    }

    /**
     * Desactivar exige la contraseña actual Y un código válido. Cierra las demás sesiones.
     *
     * @return array{enabled: bool}
     */
    public function disable({{ app.model }} $account, #[\SensitiveParameter] string $password, #[\SensitiveParameter] string $code): array
    {
        $mfa = $this->assertSecondFactor($account, $password, $code);

        DB::transaction(function () use ($account, $mfa) {
            {{ app.model }}Mfa::query()->whereKey($mfa->getKey())->delete();
            {{ app.model }}MfaChallenge::query()->where('account_id', $account->getKey())->delete();
        });
        $this->revokeOtherTokens($account);

        return ['enabled' => false];
    }

    /**
     * Genera códigos de recuperación nuevos (los anteriores dejan de valer). Exige contraseña Y un código válido.
     *
     * @return array{recovery_codes: list<string>}
     */
    public function regenerateRecoveryCodes({{ app.model }} $account, #[\SensitiveParameter] string $password, #[\SensitiveParameter] string $code): array
    {
        $mfa = $this->assertSecondFactor($account, $password, $code);

        [$plain, $hashes] = $this->newRecoveryCodes();
        {{ app.model }}Mfa::query()->whereKey($mfa->getKey())->update(['recovery_codes' => json_encode($hashes)]);

        return ['recovery_codes' => $plain];
    }

    /** Contraseña + código válidos, o el mismo 422 para ambos fallos. Devuelve el MFA confirmado. */
    private function assertSecondFactor({{ app.model }} $account, string $password, string $code): {{ app.model }}Mfa
    {
        $this->assertNotLocked($account);

        $mfa = $this->confirmed($account);
        if ($mfa === null) {
            throw new UserFacingException('Two-factor authentication is not enabled.', 409);
        }

        if (! Hash::check($password, $account->password) || ! $this->checkCode($mfa, $code)) {
            $this->recordFailure($account);

            throw new UserFacingException('Invalid password or code.', 422);
        }

        RateLimiter::clear($this->failureKey((int) $account->getKey()));

        return $mfa;
    }

    /** Un código de 6 dígitos es TOTP; cualquier otra cosa se trata como código de recuperación. */
    private function checkCode({{ app.model }}Mfa $mfa, string $code): bool
    {
        $code = trim($code);

        return preg_match('/^\d{6}$/', $code) === 1
            ? is_int($this->claimTotp($mfa, $code))
            : $this->claimRecovery($mfa, $code);
    }

    /** Paso TOTP válido y MÁS NUEVO que el último aceptado, o false. No reserva nada. */
    private function matchTotp({{ app.model }}Mfa $mfa, string $code): int|false
    {
        $code = trim($code);
        if (preg_match('/^\d{6}$/', $code) !== 1) {
            return false;
        }

        // Con un último paso entero (0 si no hay) verifyKeyNewer devuelve el paso que coincidió, no `true`.
        $step = $this->totp()->verifyKeyNewer($mfa->secret, $code, (int) ($mfa->last_used_step ?? 0));

        return is_int($step) ? $step : false;
    }

    /**
     * Acepta el código solo si su paso es más nuevo que el último guardado. El UPDATE condicional es lo que hace
     * atómico el "una sola vez": con dos peticiones simultáneas con el mismo código, solo una afecta la fila.
     */
    private function claimTotp({{ app.model }}Mfa $mfa, string $code): int|false
    {
        $step = $this->matchTotp($mfa, $code);
        if ($step === false) {
            return false;
        }

        $claimed = {{ app.model }}Mfa::query()
            ->whereKey($mfa->getKey())
            ->where(fn ($q) => $q->whereNull('last_used_step')->orWhere('last_used_step', '<', $step))
            ->update(['last_used_step' => $step]);

        return $claimed === 1 ? $step : false;
    }

    /** Código de recuperación de un solo uso: se quita de la lista bajo bloqueo de fila. */
    private function claimRecovery({{ app.model }}Mfa $mfa, string $code): bool
    {
        $normalized = Str::lower((string) preg_replace('/[\s-]+/', '', $code));
        if (preg_match('/^[a-z2-9]{10}$/', $normalized) !== 1) {
            return false;
        }
        $given = $this->hashRecovery($normalized);

        return DB::transaction(function () use ($mfa, $given) {
            $row = {{ app.model }}Mfa::query()->lockForUpdate()->find($mfa->getKey());
            $hashes = $row?->confirmed_at === null ? [] : array_values($row->recovery_codes ?? []);

            $found = null;
            foreach ($hashes as $i => $hash) {
                if (hash_equals((string) $hash, $given)) {
                    $found = $i; // sin `break`: se recorren todos
                }
            }
            if ($found === null) {
                return false;
            }

            unset($hashes[$found]);
            $row->recovery_codes = array_values($hashes);
            $row->save();

            return true;
        });
    }

    /** @return array{0: list<string>, 1: list<string>} [códigos en claro para mostrar, hashes para guardar] */
    private function newRecoveryCodes(): array
    {
        $plain = [];
        $hashes = [];
        $max = strlen(self::RECOVERY_ALPHABET) - 1;
        for ($i = 0; $i < (int) config('mfa_{{ app.key }}.recovery_codes'); $i++) {
            $code = '';
            for ($j = 0; $j < 10; $j++) {
                $code .= self::RECOVERY_ALPHABET[random_int(0, $max)];
            }
            $plain[] = substr($code, 0, 5) . '-' . substr($code, 5);
            $hashes[] = $this->hashRecovery($code);
        }

        return [$plain, $hashes];
    }

    /**
     * Los códigos de recuperación son aleatorios de ~50 bits y de un solo uso, con tope de intentos: un HMAC con
     * la clave de la app basta y permite compararlos todos sin 10 bcrypt por intento.
     */
    private function hashRecovery(string $normalized): string
    {
        return hash_hmac('sha256', $normalized, (string) config('app.key'));
    }

    private function confirmed({{ app.model }} $account): ?{{ app.model }}Mfa
    {
        return {{ app.model }}Mfa::query()->where('account_id', $account->getKey())->whereNotNull('confirmed_at')->first();
    }

    /** @return array<string, mixed> */
    private function startChallenge({{ app.model }} $account): array
    {
        // Limpieza: desafíos vencidos o usados de esta cuenta.
        {{ app.model }}MfaChallenge::query()
            ->where('account_id', $account->getKey())
            ->where(fn ($q) => $q->where('expires_at', '<', now())->orWhereNotNull('used_at'))
            ->delete();

        $ttl = (int) config('mfa_{{ app.key }}.challenge_ttl_seconds');
        $value = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');

        $row = new {{ app.model }}MfaChallenge();
        $row->forceFill([
            'account_id' => $account->getKey(),
            'token_hash' => hash('sha256', $value),
            'attempts' => 0,
            'expires_at' => now()->addSeconds($ttl),
        ])->save();

        return ['mfa_required' => true, 'challenge' => $value, 'expires_in' => $ttl, 'methods' => ['totp', 'recovery_code']];
    }

    /** @return array<string, mixed> */
    private function issueToken({{ app.model }} $account): array
    {
        try {
            return AccountResource::withToken($account, config('authentications.tokens.name', 'Personal Access Token') . ' (' . self::APP . ')');
        } catch (RuntimeException $e) {
            // Passport sin cliente personal para este provider: falta el paso de preparación.
            Log::error('Passport: no hay cliente de acceso personal para el provider de la app.', ['app' => self::APP]);

            throw new UserFacingException('Authentication is not configured. Run `php artisan authentications:setup`.', 500, previous: $e);
        }
    }

    /** Cierra las demás sesiones: conserva solo el token de la petición actual. */
    private function revokeOtherTokens({{ app.model }} $account): void
    {
        $current = $account->token()?->id;
        $account->tokens()->when($current, fn ($q) => $q->where('id', '!=', $current))->each(function ($t) {
            $t->revoke();
            $t->refreshToken?->revoke();
        });
    }

    private function totp(): Google2FA
    {
        $totp = new Google2FA();
        $totp->setWindow((int) config('mfa_{{ app.key }}.window'));

        return $totp;
    }

    private function otpauthUrl({{ app.model }} $account, string $secret): string
    {
        $issuer = (string) config('mfa_{{ app.key }}.issuer');

        return 'otpauth://totp/' . rawurlencode($issuer) . ':' . rawurlencode((string) $account->email)
            . '?secret=' . $secret . '&issuer=' . rawurlencode($issuer) . '&algorithm=SHA1&digits=6&period=30';
    }

    private function assertNotLocked({{ app.model }} $account): void
    {
        if (RateLimiter::tooManyAttempts($this->failureKey((int) $account->getKey()), $this->maxFailures())) {
            throw new UserFacingException('Too many attempts. Try again later.', 429);
        }
    }

    private function recordFailure({{ app.model }} $account): void
    {
        RateLimiter::hit($this->failureKey((int) $account->getKey()), $this->failureWindow());
    }

    private function failureKey(int $accountId): string
    {
        return 'mfa-fail:' . self::APP . ':' . $accountId;
    }

    private function maxFailures(): int
    {
        return (int) config('mfa_{{ app.key }}.account_max_failures');
    }

    private function failureWindow(): int
    {
        return (int) config('mfa_{{ app.key }}.account_failure_window_minutes') * 60;
    }

    private function invalidCode(): UserFacingException
    {
        return new UserFacingException('Invalid or expired code.', 401);
    }
}
