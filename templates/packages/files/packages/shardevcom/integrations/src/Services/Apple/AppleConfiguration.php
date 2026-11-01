<?php

namespace Shardevcom\Integrations\Services\Apple;

/**
 * Configuración de Sign in with Apple (config/services.php → `services.apple`).
 *
 * La funcionalidad está APAGADA salvo que estén todas las claves requeridas:
 * sin ellas los endpoints de Apple fallan cerrados (503 / ?error=503) y el
 * resto de la aplicación sigue funcionando. No existe ningún valor por defecto
 * para la clave privada ni para los identificadores de equipo/clave.
 */
class AppleConfiguration
{
    public const ISSUER = 'https://appleid.apple.com';

    public const AUTHORIZE_URL = 'https://appleid.apple.com/auth/authorize';

    public const TOKEN_URL = 'https://appleid.apple.com/auth/token';

    public const REVOKE_URL = 'https://appleid.apple.com/auth/revoke';

    public const JWKS_URL = 'https://appleid.apple.com/auth/keys';

    public function isEnabled(): bool
    {
        // Doble barrera: el flag derivado en config/services.php y la
        // presencia real de cada clave (un test o un override que ponga
        // enabled=true sin claves no enciende la funcionalidad).
        return (bool) config('services.apple.enabled')
            && $this->serviceId() !== ''
            && $this->bundleId() !== ''
            && $this->teamId() !== ''
            && $this->keyId() !== ''
            && $this->privateKey() !== ''
            && $this->redirectUri() !== '';
    }

    /**
     * @throws AppleSignInException si la funcionalidad está apagada.
     */
    public function assertEnabled(): void
    {
        if (! $this->isEnabled()) {
            throw AppleSignInException::notConfigured();
        }
    }

    /** Services ID: client_id del flujo web/Android y `aud` de sus id_token. */
    public function serviceId(): string
    {
        return trim((string) config('services.apple.client_id'));
    }

    /** Bundle ID de la app iOS: client_id y `aud` del flujo nativo. */
    public function bundleId(): string
    {
        return trim((string) config('services.apple.bundle_id'));
    }

    public function teamId(): string
    {
        return trim((string) config('services.apple.team_id'));
    }

    public function keyId(): string
    {
        return trim((string) config('services.apple.key_id'));
    }

    /** Clave .p8 (PEM). config/services.php ya convierte los "\n" literales. */
    public function privateKey(): string
    {
        return str_replace('\n', "\n", trim((string) config('services.apple.private_key')));
    }

    public function redirectUri(): string
    {
        return trim((string) config('services.apple.redirect'));
    }

    /**
     * Client IDs con los que pudo emitirse un refresh token de Apple: el
     * Services ID (web) y el Bundle ID (nativo). La revocación los prueba en
     * orden porque la cuenta no guarda con cuál se obtuvo.
     *
     * @return list<string>
     */
    public function clientIds(): array
    {
        return array_values(array_unique(array_filter([$this->serviceId(), $this->bundleId()])));
    }
}
