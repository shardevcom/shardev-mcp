<?php

namespace Shardevcom\Authentications\Services;

use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use RuntimeException;
use Shardevcom\Authentications\Events\PasswordChanged;
use Shardevcom\Authentications\Http\Resources\AccountResource;
use Shardevcom\Authentications\Models\Account;
use Shardevcom\Authentications\Support\AppRegistry;
use Shardevcom\Supports\Exceptions\UserFacingException;

/**
 * Login, logout y perfil de las cuentas de una app. La app llega siempre del controlador de la
 * app (nunca del cliente) y la cuenta autenticada siempre de su guard: ningún id viene del body.
 */
class AccountAuthService
{
    /** Hash descartable (uno por proceso) para igualar el tiempo de respuesta cuando el email no existe. */
    private static ?string $dummyHash = null;

    public function login(string $app, array $credentials): array
    {
        /** @var class-string<Account> $model */
        $model = AppRegistry::get($app)['model'];

        $account = $model::query()->where('email', $credentials['email'])->first();

        // Cuenta inexistente, contraseña errónea o cuenta inactiva: misma respuesta y mismo coste.
        $valid = Hash::check($credentials['password'], $account?->password ?? (self::$dummyHash ??= Hash::make(Str::random(32))));

        if (! $account || ! $valid || ! $account->active) {
            throw new UserFacingException('Invalid credentials.', 401);
        }

        return $this->issueToken($app, $account);
    }

    public function logout(?Authenticatable $account): void
    {
        // Revoca el access token Y su refresh token de esta sesión; las demás sesiones siguen.
        $token = $account?->token();
        $token?->revoke();
        $token?->refreshToken?->revoke();
    }

    public function profile(Account $account): array
    {
        return (new AccountResource($account))->toArray(request());
    }

    public function updateProfile(Account $account, array $data): array
    {
        $account->update($data);

        return $this->profile($account->fresh());
    }

    public function changePassword(string $app, Account $account, array $data): array
    {
        if (! Hash::check($data['current_password'], $account->password)) {
            throw new UserFacingException('The current password is not valid.', 422);
        }

        if ($data['current_password'] === $data['new_password']) {
            throw new UserFacingException('The new password must differ from the current one.', 422);
        }

        $account->update(['password' => $data['new_password']]);

        // Cierra las demás sesiones: conserva solo el token de la petición actual.
        $current = $account->token()?->id;
        $account->tokens()->when($current, fn ($q) => $q->where('id', '!=', $current))->each(function ($t) {
            $t->revoke();
            $t->refreshToken?->revoke();
        });

        event(new PasswordChanged($account));

        return $this->profile($account->fresh());
    }

    private function issueToken(string $app, Account $account): array
    {
        try {
            return AccountResource::withToken($account, config('authentications.tokens.name', 'Personal Access Token') . " ({$app})");
        } catch (RuntimeException $e) {
            // Passport sin cliente personal para este provider: falta el paso de preparación.
            Log::error('Passport: no hay cliente de acceso personal para el provider de la app.', ['app' => $app]);

            throw new UserFacingException('Authentication is not configured. Run `php artisan authentications:setup`.', 500, previous: $e);
        }
    }
}
