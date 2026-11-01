<?php

namespace Shardevcom\Integrations\Services\Apple;

use Firebase\JWT\JWT;
use stdClass;
use Throwable;

/**
 * Verifica un id_token de Sign in with Apple antes de confiar en cualquiera de
 * sus claims: firma RS256 contra el JWKS publicado por Apple, `exp`/`iat`
 * (JWT::decode los comprueba, aquí además se exige que existan), `iss`, `aud`
 * y, cuando se indica, `nonce`.
 *
 *  - Nativo (iOS): aud = Bundle ID; nonce = sha256 hex del nonce crudo que
 *    envía el cliente (el plugin de iOS entrega a Apple el nonce ya hasheado).
 *  - Web/Android: aud = Services ID; nonce = el guardado para ese `state`.
 */
class AppleIdTokenVerifier
{
    public function __construct(protected AppleJwksService $jwks) {}

    /**
     * @param  string|null  $expectedNonce  null solo para un id_token recibido por
     *                                      canal directo (respuesta de /auth/token)
     *                                      cuya identidad ya se ató a otro token verificado.
     *
     * @throws AppleSignInException si la firma o algún claim no es válido.
     */
    public function verify(string $idToken, string $audience, ?string $expectedNonce): stdClass
    {
        if ($audience === '') {
            throw AppleSignInException::notConfigured();
        }

        $header = $this->decodeHeader($idToken);
        $keyId = $header->kid ?? null;

        if (! is_string($keyId) || $keyId === '' || ($header->alg ?? null) !== 'RS256') {
            throw AppleSignInException::invalidToken();
        }

        $key = $this->jwks->getPublicKey($keyId);

        try {
            // Verifica la firma y exp/nbf/iat (si están presentes).
            $claims = JWT::decode($idToken, $key);
        } catch (Throwable $e) {
            throw AppleSignInException::invalidToken($e::class);
        }

        $this->assertValidClaims($claims, $audience, $expectedNonce);

        return $claims;
    }

    protected function decodeHeader(string $idToken): stdClass
    {
        $parts = explode('.', $idToken);

        if (count($parts) !== 3) {
            throw AppleSignInException::invalidToken();
        }

        try {
            $header = JWT::jsonDecode(JWT::urlsafeB64Decode($parts[0]));
        } catch (Throwable $e) {
            throw AppleSignInException::invalidToken($e::class);
        }

        if (! $header instanceof stdClass) {
            throw AppleSignInException::invalidToken();
        }

        return $header;
    }

    protected function assertValidClaims(stdClass $claims, string $audience, ?string $expectedNonce): void
    {
        if (($claims->iss ?? null) !== AppleConfiguration::ISSUER) {
            throw AppleSignInException::invalidToken();
        }

        // Apple emite `aud` como string (un único client_id).
        if (! is_string($claims->aud ?? null) || ! hash_equals($audience, $claims->aud)) {
            throw AppleSignInException::invalidToken();
        }

        // JWT::decode solo valida exp/iat si vienen: aquí son obligatorios.
        if (! is_numeric($claims->exp ?? null) || ! is_numeric($claims->iat ?? null)) {
            throw AppleSignInException::invalidToken();
        }

        if (! is_string($claims->sub ?? null) || trim($claims->sub) === '') {
            throw AppleSignInException::invalidToken();
        }

        if ($expectedNonce !== null) {
            $nonce = $claims->nonce ?? null;

            if ($expectedNonce === '' || ! is_string($nonce) || ! hash_equals($expectedNonce, $nonce)) {
                throw AppleSignInException::invalidToken();
            }
        }
    }

    /**
     * Normaliza los claims booleanos de Apple, que pueden llegar como bool o
     * como string "true"/"false" (email_verified, is_private_email).
     */
    public static function claimIsTrue(stdClass $claims, string $name): bool
    {
        $value = $claims->{$name} ?? null;

        return $value === true || $value === 'true';
    }
}
