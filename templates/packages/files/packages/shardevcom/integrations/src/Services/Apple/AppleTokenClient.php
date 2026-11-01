<?php

namespace Shardevcom\Integrations\Services\Apple;

use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * Llamadas servidor→Apple con client_secret: intercambio del authorization
 * code (/auth/token) y revocación de tokens (/auth/revoke, requisito App Store
 * 5.1.1(v)). Ni las peticiones ni las respuestas se registran en logs.
 */
class AppleTokenClient
{
    private const TIMEOUT_SECONDS = 10;

    public function __construct(protected AppleClientSecret $clientSecret) {}

    /**
     * @return array{id_token: string, refresh_token: ?string}
     *
     * @throws AppleSignInException
     */
    public function exchangeCode(string $code, string $clientId, ?string $redirectUri = null): array
    {
        $form = [
            'client_id' => $clientId,
            'client_secret' => $this->clientSecret->generate($clientId),
            'code' => $code,
            'grant_type' => 'authorization_code',
        ];

        // Solo el flujo web lleva redirect_uri (debe coincidir con el del authorize).
        if ($redirectUri !== null && $redirectUri !== '') {
            $form['redirect_uri'] = $redirectUri;
        }

        try {
            $response = Http::asForm()->acceptJson()->timeout(self::TIMEOUT_SECONDS)
                ->post(AppleConfiguration::TOKEN_URL, $form);
        } catch (Throwable $e) {
            throw AppleSignInException::exchangeFailed(0, $e::class);
        }

        if (! $response->successful()) {
            throw AppleSignInException::exchangeFailed($response->status());
        }

        $idToken = $response->json('id_token');
        $refreshToken = $response->json('refresh_token');

        if (! is_string($idToken) || $idToken === '') {
            throw AppleSignInException::exchangeFailed($response->status());
        }

        return [
            'id_token' => $idToken,
            // El access_token de Apple no da acceso a nada útil para este proyecto y no se conserva.
            'refresh_token' => is_string($refreshToken) && $refreshToken !== '' ? $refreshToken : null,
        ];
    }

    /**
     * Revoca un refresh/access token de Apple. Devuelve true solo si Apple
     * responde 2xx; nunca lanza (el llamador decide si reintentar con otro client_id).
     */
    public function revoke(string $token, string $clientId, string $tokenTypeHint = 'refresh_token'): bool
    {
        try {
            $response = Http::asForm()->acceptJson()->timeout(self::TIMEOUT_SECONDS)
                ->post(AppleConfiguration::REVOKE_URL, [
                    'client_id' => $clientId,
                    'client_secret' => $this->clientSecret->generate($clientId),
                    'token' => $token,
                    'token_type_hint' => $tokenTypeHint,
                ]);
        } catch (Throwable) {
            return false;
        }

        return $response->successful();
    }
}
