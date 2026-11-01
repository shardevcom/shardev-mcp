<?php

namespace App\Auth\Social;

use {{ app.model_class }};
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use RuntimeException;
use Shardevcom\Authentications\Http\Resources\AccountResource;
use Shardevcom\Integrations\Services\Apple\AppleIdTokenVerifier;
use Shardevcom\Integrations\Services\Google\GoogleIdTokenVerifier;
use Shardevcom\Integrations\Services\Google\GoogleJwksService;
use Shardevcom\Integrations\Services\Microsoft\MicrosoftIdTokenVerifier;
use Shardevcom\Supports\Exceptions\UserFacingException;
use stdClass;
use Throwable;

/**
 * Login por identidad verificada del proveedor, en la app `{{ app.key }}`.
 *
 * Reglas:
 *  - el id_token se verifica SIEMPRE con los verificadores de `integrations` (firma contra el JWKS del emisor,
 *    iss, aud, exp). No hay decode base64 de reserva, y un proveedor desconocido o no habilitado se rechaza;
 *  - la identidad sale de los claims verificados (`sub`). Un correo enviado por el cliente no se lee nunca;
 *  - entrar con una identidad sin vínculo solo se enlaza a una cuenta por correo si el proveedor garantiza que el
 *    correo está verificado. Si no, falla cerrado (para vincular hay `link`, con la cuenta ya autenticada);
 *  - los vínculos viven en la tabla de ESTA app: una identidad vinculada aquí no existe en otra app;
 *  - ningún token ni claim se registra: solo app, proveedor y clase de la excepción.
 *
 * Claims en los que se apoya cada proveedor:
 *  - google:    sub, email, email_verified (bool o "true"). iss y aud los comprueba el verificador (aquí aud admite
 *               GOOGLE_CLIENT_ID y GOOGLE_NATIVE_CLIENT_ID).
 *  - microsoft: sub. Su `email` NO se usa para enlazar: Entra ID no lo garantiza verificado (ataque nOAuth), así que
 *               la primera vinculación es con `link`.
 *  - apple:     sub, email, email_verified (bool o "true"). aud: APPLE_BUNDLE_ID o APPLE_SERVICE_ID.
 */
class {{ app.model }}SocialService
{
    private const APP = '{{ app.key }}';

    /** @return list<string> */
    private function providers(): array
    {
        return array_values((array) config('social_{{ app.key }}.providers', []));
    }

    /**
     * Lo que el SPA necesita para ofrecer botones: solo proveedores habilitados Y con su client id configurado.
     * Son datos públicos (un client id va en la URL de autorización). Apple no se ofrece desde el navegador:
     * su flujo web exige un receptor form_post; Apple entra por `POST auth/social/apple` con el id_token del cliente nativo.
     *
     * @return list<array<string, string>>
     */
    public function publicProviders(): array
    {
        $out = [];
        foreach ($this->providers() as $provider) {
            if ($provider === 'google' && is_string($id = config('services.google.client_id')) && $id !== '') {
                $out[] = ['provider' => 'google', 'client_id' => $id];
            }
            if ($provider === 'microsoft' && is_string($id = config('services.microsoft.client_id')) && $id !== '') {
                $out[] = ['provider' => 'microsoft', 'client_id' => $id, 'tenant' => (string) config('services.microsoft.tenant', 'consumers')];
            }
        }

        return $out;
    }

    /** @return array<string, mixed> perfil y token */
    public function login(string $provider, string $idToken): array
    {
        $identity = $this->verify($provider, $idToken);

        try {
            $account = DB::transaction(fn () => $this->resolveAccount($provider, $identity));
        } catch (UniqueConstraintViolationException) {
            // Otra petición enlazó la misma identidad a la vez: el cliente reintenta y entra por el vínculo.
            throw $this->invalid();
        }

        if ($account === null || ! $account->active) {
            throw $this->invalid();
        }

        return AccountResource::withToken($account, config('authentications.tokens.name', 'Personal Access Token') . ' (' . self::APP . ')');
    }

    /**
     * Vincula la identidad a la cuenta autenticada. Es el camino para Microsoft, que no enlaza por correo.
     *
     * @return array{provider: string, linked: bool}
     */
    public function link({{ app.model }} $account, string $provider, string $idToken): array
    {
        $identity = $this->verify($provider, $idToken);

        $existing = {{ app.model }}SocialIdentity::query()->where('provider', $provider)->where('subject', $identity['subject'])->first();
        if ($existing !== null) {
            if ((int) $existing->account_id === (int) $account->getKey()) {
                return ['provider' => $provider, 'linked' => true];
            }

            throw $this->cannotLink();
        }
        if ({{ app.model }}SocialIdentity::query()->where('account_id', $account->getKey())->where('provider', $provider)->exists()) {
            throw $this->cannotLink();
        }

        try {
            $this->createLink($account, $provider, $identity);
        } catch (UniqueConstraintViolationException) {
            throw $this->cannotLink();
        }

        return ['provider' => $provider, 'linked' => true];
    }

    /**
     * @param  array{subject: string, email: ?string, email_verified: bool, name: ?string}  $identity
     */
    private function resolveAccount(string $provider, array $identity): ?{{ app.model }}
    {
        $link = {{ app.model }}SocialIdentity::query()->where('provider', $provider)->where('subject', $identity['subject'])->lockForUpdate()->first();
        if ($link !== null) {
            return {{ app.model }}::query()->find($link->account_id);
        }

        // Sin vínculo: solo se enlaza por un correo que el proveedor garantiza verificado. Si no, falla cerrado.
        if (! $identity['email_verified'] || $identity['email'] === null) {
            return null;
        }

        $account = {{ app.model }}::query()->whereRaw('lower(email) = ?', [$identity['email']])->lockForUpdate()->first();
        if ($account === null) {
            if (! config('social_{{ app.key }}.auto_register')) {
                return null;
            }
            $account = {{ app.model }}::create([
                'name' => $identity['name'] ?: Str::before($identity['email'], '@'),
                'email' => $identity['email'],
                'password' => Str::random(64), // aleatoria y nunca revelada: el modelo la guarda hasheada
                'active' => true,
            ]);
            $account->forceFill(['email_verified_at' => now()])->save();
        } elseif (! $account->active || {{ app.model }}SocialIdentity::query()->where('account_id', $account->getKey())->where('provider', $provider)->exists()) {
            // Cuenta inactiva, o ya vinculada a OTRA identidad del mismo proveedor: no se reasigna por correo.
            return null;
        }

        $this->createLink($account, $provider, $identity);

        return $account;
    }

    /** @param array{subject: string, email: ?string, email_verified: bool, name: ?string} $identity */
    private function createLink({{ app.model }} $account, string $provider, array $identity): void
    {
        $link = new {{ app.model }}SocialIdentity([
            'provider' => $provider,
            'subject' => $identity['subject'],
            'email' => $identity['email'],
            'email_verified' => $identity['email_verified'],
        ]);
        $link->account_id = $account->getKey();
        $link->save();
    }

    /**
     * Verifica el id_token y devuelve SOLO la identidad normalizada.
     *
     * @return array{subject: string, email: ?string, email_verified: bool, name: ?string}
     */
    private function verify(string $provider, string $idToken): array
    {
        if (! in_array($provider, $this->providers(), true)) {
            throw new UserFacingException('Unsupported provider.', 404);
        }
        if (strlen($idToken) > 8192 || substr_count($idToken, '.') !== 2) {
            throw $this->invalid();
        }

        try {
            $claims = match ($provider) {
                'google' => $this->verifyGoogle($idToken),
                'microsoft' => app(MicrosoftIdTokenVerifier::class)->verify($idToken),
                'apple' => $this->verifyApple($idToken),
                default => throw new RuntimeException('Unsupported provider.'),
            };

            return $this->identity($provider, $claims);
        } catch (UserFacingException $e) {
            throw $e;
        } catch (Throwable $e) {
            // Nunca el mensaje ni el token: solo qué app, qué proveedor y qué clase de fallo.
            Log::warning('Social login: id_token rechazado.', ['app' => self::APP, 'provider' => $provider, 'error' => $e::class]);

            throw $this->invalid();
        }
    }

    /**
     * El verificador de Google de `integrations` comprueba la firma contra el JWKS, `exp` e `iss`, pero su
     * audiencia es solo GOOGLE_NATIVE_CLIENT_ID. Aquí se admiten el client id web y el nativo (uno por flujo);
     * la firma y la expiración siguen siendo las del verificador original.
     */
    private function verifyGoogle(string $idToken): stdClass
    {
        $audiences = array_values(array_filter(
            [config('services.google.client_id'), config('services.google.native_client_id')],
            fn ($v) => is_string($v) && $v !== '',
        ));
        if ($audiences === []) {
            throw new RuntimeException('Google no está configurado.');
        }

        $verifier = new class(app(GoogleJwksService::class), $audiences) extends GoogleIdTokenVerifier {
            /** @param list<string> $audiences */
            public function __construct(GoogleJwksService $jwks, private array $audiences)
            {
                parent::__construct($jwks);
            }

            protected function assertValidClaims(stdClass $decoded): void
            {
                if (! isset($decoded->iss) || ! in_array($decoded->iss, static::ALLOWED_ISSUERS, true)) {
                    throw new RuntimeException('Invalid Google id_token issuer.');
                }
                if (! is_string($decoded->aud ?? null) || ! in_array($decoded->aud, $this->audiences, true)) {
                    throw new RuntimeException('Invalid Google id_token audience.');
                }
                if (empty($decoded->sub)) {
                    throw new RuntimeException('Google id_token missing subject (sub).');
                }
            }
        };

        return $verifier->verify($idToken);
    }

    private function verifyApple(string $idToken): stdClass
    {
        $audiences = array_values(array_filter(
            [config('services.apple.bundle_id'), config('services.apple.client_id')],
            fn ($v) => is_string($v) && trim($v) !== '',
        ));

        $last = new RuntimeException('Apple no está configurado.');
        foreach ($audiences as $audience) {
            try {
                // Sin nonce esperado: el servidor no emite nonces, y uno elegido por el cliente se podría omitir.
                return app(AppleIdTokenVerifier::class)->verify($idToken, $audience, null);
            } catch (Throwable $e) {
                $last = $e;
            }
        }

        throw $last;
    }

    /**
     * @return array{subject: string, email: ?string, email_verified: bool, name: ?string}
     */
    private function identity(string $provider, stdClass $claims): array
    {
        $subject = $claims->sub ?? null;
        if (! is_string($subject) || $subject === '' || strlen($subject) > 255) {
            throw new RuntimeException('sub inválido.');
        }
        // JWT::decode solo comprueba exp si viene; aquí es obligatorio (Apple ya lo exige).
        if (! is_numeric($claims->exp ?? null)) {
            throw new RuntimeException('exp ausente.');
        }

        $email = isset($claims->email) && is_string($claims->email) ? Str::lower(trim($claims->email)) : null;
        if ($email !== null && filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            $email = null;
        }

        $flag = $claims->email_verified ?? null;
        $verified = match ($provider) {
            'google', 'apple' => $flag === true || $flag === 'true',
            default => false, // microsoft: ver la nota de la clase
        };

        return [
            'subject' => $subject,
            'email' => $email,
            'email_verified' => $email !== null && $verified,
            'name' => isset($claims->name) && is_string($claims->name) && trim($claims->name) !== '' ? mb_substr(trim($claims->name), 0, 120) : null,
        ];
    }

    private function invalid(): UserFacingException
    {
        return new UserFacingException('Invalid credentials.', 401);
    }

    private function cannotLink(): UserFacingException
    {
        return new UserFacingException('This identity cannot be linked.', 409);
    }
}
