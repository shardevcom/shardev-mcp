<?php

namespace Shardevcom\Integrations\Services\Apple;

use Firebase\JWT\JWT;
use Throwable;

/**
 * client_secret de Apple: un JWT ES256 firmado en tiempo de ejecución con la
 * clave .p8 (APPLE_PRIVATE_KEY). Se genera en cada uso con vida corta y nunca
 * se guarda ni se registra en logs.
 *
 * `sub` debe ser el mismo client_id con el que se usa: el Services ID para el
 * flujo web y el Bundle ID para códigos emitidos a la app iOS.
 */
class AppleClientSecret
{
    /** Vida del client_secret: Apple admite hasta 6 meses; aquí basta con minutos. */
    public const TTL_SECONDS = 300;

    public function __construct(protected AppleConfiguration $config) {}

    /**
     * @throws AppleSignInException si la funcionalidad está apagada o la clave no es una clave EC válida.
     */
    public function generate(string $clientId): string
    {
        $this->config->assertEnabled();

        if ($clientId === '') {
            throw AppleSignInException::notConfigured();
        }

        $pem = $this->config->privateKey();
        $key = openssl_pkey_get_private($pem);

        if ($key === false) {
            throw AppleSignInException::notConfigured();
        }

        $details = openssl_pkey_get_details($key);

        if (! is_array($details) || ($details['type'] ?? null) !== OPENSSL_KEYTYPE_EC) {
            throw AppleSignInException::notConfigured();
        }

        $now = time();

        try {
            return JWT::encode([
                'iss' => $this->config->teamId(),
                'iat' => $now,
                'exp' => $now + self::TTL_SECONDS,
                'aud' => AppleConfiguration::ISSUER,
                'sub' => $clientId,
            ], $pem, 'ES256', $this->config->keyId());
        } catch (Throwable) {
            throw AppleSignInException::notConfigured();
        }
    }
}
