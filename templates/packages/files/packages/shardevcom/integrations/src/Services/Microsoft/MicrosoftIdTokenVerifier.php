<?php

namespace Shardevcom\Integrations\Services\Microsoft;

use Firebase\JWT\JWT;
use RuntimeException;
use stdClass;

/**
 * Verifica la firma y los claims (iss/aud/exp) de un id_token de Microsoft
 * generado por el flujo nativo/web — nunca deben aceptarse claims de un
 * id_token sin haber verificado su firma contra el JWKS publicado por
 * Microsoft primero.
 */
class MicrosoftIdTokenVerifier
{
    public function __construct(
        protected MicrosoftJwksService $jwks,
        protected MicrosoftOidcConfiguration $oidcConfig
    ) {
    }

    /**
     * @throws RuntimeException si la firma o los claims no son válidos.
     */
    public function verify(string $idToken): stdClass
    {
        $keyId = $this->decodeHeader($idToken)->kid ?? null;

        if (!$keyId) {
            throw new RuntimeException('Microsoft id_token missing key ID (kid).');
        }

        $key = $this->jwks->getPublicKey($keyId);

        // JWT::decode ya verifica la firma y exp/nbf/iat; solo faltan iss/aud/sub.
        $decoded = JWT::decode($idToken, $key);

        $this->assertValidClaims($decoded);

        return $decoded;
    }

    protected function decodeHeader(string $idToken): stdClass
    {
        $parts = explode('.', $idToken);

        if (count($parts) !== 3) {
            throw new RuntimeException('Invalid Microsoft id_token structure.');
        }

        $header = json_decode(
            base64_decode(str_replace(['-', '_'], ['+', '/'], $parts[0]))
        );

        if (!$header instanceof stdClass) {
            throw new RuntimeException('Invalid Microsoft id_token header.');
        }

        return $header;
    }

    protected function assertValidClaims(stdClass $decoded): void
    {
        $expectedIssuer = $this->oidcConfig->getIssuer();

        if (!isset($decoded->iss) || $decoded->iss !== $expectedIssuer) {
            throw new RuntimeException('Invalid Microsoft id_token issuer.');
        }

        $expectedAudience = config('services.microsoft.client_id');

        if (!$expectedAudience) {
            throw new RuntimeException('Microsoft client_id is not configured.');
        }

        if (!isset($decoded->aud) || $decoded->aud !== $expectedAudience) {
            throw new RuntimeException('Invalid Microsoft id_token audience.');
        }

        if (empty($decoded->sub)) {
            throw new RuntimeException('Microsoft id_token missing subject (sub).');
        }
    }
}
