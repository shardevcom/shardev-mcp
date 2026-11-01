<?php

namespace App\Auth\Invitations;

use {{ app.model_class }};
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Shardevcom\Supports\Exceptions\UserFacingException;
use Throwable;

/**
 * Alta por invitación de la app `{{ app.key }}`. Esta app NO tiene registro público.
 *
 * Reglas que NO se negocian aquí:
 *  - del token solo se guarda su sha256; el token jamás se registra ni se pone en una cola;
 *  - una invitación se canjea una sola vez (UPDATE condicional atómico), vale 7 días por defecto y está ligada
 *    al correo invitado y a esta app (su tabla es la de la app);
 *  - invitar responde lo mismo exista o no la cuenta y, si existe, no envía nada;
 *  - las invitaciones NO asignan roles (v1): invitar no permite escalar privilegios;
 *  - quien invita sale de la cuenta autenticada, nunca de la entrada.
 */
class {{ app.model }}InvitationService
{
    private const APP = '{{ app.key }}';

    private const GUARD = '{{ app.api_guard }}';

    /** El permiso `<acción>:invitations` del guard de la app, comprobado en el servidor en cada petición. */
    public function authorize(?Authenticatable $account, string $action): void
    {
        if ($account === null
            || ! (method_exists($account, 'checkPermissionTo')
                && ($account->checkPermissionTo("{$action}:invitations", self::GUARD) || $account->checkPermissionTo('manage:invitations', self::GUARD)))) {
            throw new UserFacingException('This action is unauthorized.', 403);
        }
    }

    /** En producción el mailer `log`/`array` no entrega nada y `log` escribiría el enlace con el token en el log. */
    public function assertCanSend(): void
    {
        if (app()->isProduction() && in_array(config('mail.default'), ['log', 'array'], true)) {
            throw new UserFacingException('Email delivery is not configured.', 503);
        }
    }

    public function assertInviterWithinLimit(int $inviterId): void
    {
        $key = 'invite:' . self::APP . ':' . $inviterId;
        if (RateLimiter::tooManyAttempts($key, (int) config('invitations_{{ app.key }}.max_per_inviter_per_hour'))) {
            throw new UserFacingException('Too many attempts. Try again later.', 429);
        }
        RateLimiter::hit($key, 3600);
    }

    public function accountExists(string $email): bool
    {
        return {{ app.model }}::query()->whereRaw('lower(email) = ?', [$this->normalize($email)])->exists();
    }

    /**
     * Crea la invitación y envía el correo. Nunca lanza por motivos de negocio: si ya hay una cuenta con el correo
     * (o se superó el tope por correo) simplemente no envía nada y devuelve false. Las invitaciones pendientes del mismo correo
     * quedan revocadas: solo vale la última.
     */
    public function invite(?int $inviterId, string $email): bool
    {
        $email = $this->normalize($email);

        try {
            $this->assertCanSend();
            if ($this->accountExists($email)) {
                return false;
            }
            $limiter = 'invite-email:' . self::APP . ':' . sha1($email);
            if (RateLimiter::tooManyAttempts($limiter, (int) config('invitations_{{ app.key }}.max_per_email_per_hour'))) {
                return false;
            }
            RateLimiter::hit($limiter, 3600);

            $days = (int) config('invitations_{{ app.key }}.ttl_days');
            $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');

            $invitation = DB::transaction(function () use ($email, $inviterId, $token, $days) {
                {{ app.model }}Invitation::query()->where('email', $email)->whereNull('accepted_at')->whereNull('revoked_at')->update(['revoked_at' => now()]);

                $row = new {{ app.model }}Invitation();
                $row->fill(['email' => $email, 'expires_at' => now()->addDays($days)]);
                $row->forceFill(['inviter_id' => $inviterId, 'token_hash' => hash('sha256', $token)])->save();

                return $row;
            });

            try {
                Mail::to($email)->send(new {{ app.model }}InvitationMail($this->url($token), $days));
            } catch (Throwable $e) {
                // No salió el correo: la invitación no sirve a nadie. Solo la clase (el mensaje puede traer datos).
                {{ app.model }}Invitation::query()->whereKey($invitation->getKey())->update(['revoked_at' => now()]);

                throw $e;
            }

            return true;
        } catch (Throwable $e) {
            Log::warning('Invitation: no se pudo emitir la invitación.', ['app' => self::APP, 'error' => $e::class]);

            return false;
        }
    }

    /** @return list<array<string, mixed>> */
    public function list(): array
    {
        return {{ app.model }}Invitation::query()->latest('id')->limit(100)->get()->map(fn ({{ app.model }}Invitation $i) => [
            'id' => $i->getKey(),
            'email' => $i->email,
            'status' => $this->status($i),
            'inviter_id' => $i->inviter_id,
            'expires_at' => $i->expires_at?->toIso8601String(),
            'created_at' => $i->created_at?->toIso8601String(),
        ])->all();
    }

    public function revoke(int $id): void
    {
        $revoked = {{ app.model }}Invitation::query()
            ->whereKey($id)
            ->whereNull('accepted_at')
            ->whereNull('revoked_at')
            ->update(['revoked_at' => now()]);

        if ($revoked !== 1) {
            throw new UserFacingException('Invitation not found.', 404);
        }
    }

    /**
     * Canjea la invitación y crea la cuenta (con el correo de la invitación, verificado y sin roles). Invitación
     * inexistente, caducada, usada, revocada, de otra app o con correo que ya tiene cuenta: el mismo 422.
     *
     * @param  array<string, mixed>  $data  validado: name y, si la app tiene contraseña, password
     */
    public function accept(#[\SensitiveParameter] string $token, array $data): void
    {
        $hash = hash('sha256', $token);

        try {
            DB::transaction(function () use ($hash, $data) {
                $invitation = {{ app.model }}Invitation::query()->where('token_hash', $hash)->lockForUpdate()->first();
                if ($invitation === null || ! hash_equals((string) $invitation->token_hash, $hash)) {
                    throw $this->invalid();
                }

                // Un solo uso, también bajo concurrencia: solo una petición afecta la fila.
                $claimed = {{ app.model }}Invitation::query()
                    ->whereKey($invitation->getKey())
                    ->whereNull('accepted_at')
                    ->whereNull('revoked_at')
                    ->where('expires_at', '>', now())
                    ->update(['accepted_at' => now()]);
                if ($claimed !== 1 || $this->accountExists((string) $invitation->email)) {
                    throw $this->invalid(); // revierte también el canje
                }

                $account = {{ app.model }}::create([
                    'name' => (string) $data['name'],
                    'email' => (string) $invitation->email,
{{#if app.feature.otp}}
                    'password' => Str::random(64), // aleatoria y nunca revelada: esta app entra por código
{{/if}}
{{#if !app.feature.otp}}
                    'password' => (string) $data['password'],
{{/if}}
                    'active' => true,
                ]);
                // El correo se verificó al recibir el enlace. Sin roles: el dueño asigna el rol después.
                $account->forceFill(['email_verified_at' => now()])->save();
            });
        } catch (UniqueConstraintViolationException) {
            throw $this->invalid();
        }
    }

    private function status({{ app.model }}Invitation $i): string
    {
        return match (true) {
            $i->accepted_at !== null => 'accepted',
            $i->revoked_at !== null => 'revoked',
            $i->expires_at->isPast() => 'expired',
            default => 'pending',
        };
    }

    /** Enlace del correo. El token va en el fragmento (#token=): no llega a logs del servidor ni a `Referer`. */
    private function url(string $token): string
    {
        return rtrim((string) config('app.url'), '/') . '/{{ app.key }}/auth/accept-invitation#token=' . $token;
    }

    private function normalize(string $email): string
    {
        return Str::lower(trim($email));
    }

    private function invalid(): UserFacingException
    {
        return new UserFacingException('Invalid or expired invitation.', 422);
    }
}
