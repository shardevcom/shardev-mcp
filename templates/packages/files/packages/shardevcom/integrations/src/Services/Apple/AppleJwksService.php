<?php

namespace Shardevcom\Integrations\Services\Apple;

use Firebase\JWT\JWK;
use Firebase\JWT\Key;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * Claves públicas con las que Apple firma sus id_token
 * (https://appleid.apple.com/auth/keys), cacheadas 1 hora.
 *
 * A diferencia de los servicios JWKS de Google/Microsoft, aquí nunca se cachea
 * una respuesta fallida o vacía, y un `kid` desconocido provoca UNA descarga
 * nueva (rotación de claves de Apple) como máximo una vez por minuto, para que
 * un atacante no pueda forzar descargas enviando `kid` inventados.
 */
class AppleJwksService
{
    private const CACHE_KEY = 'apple_jwks';

    private const CACHE_TTL = 3600;

    private const REFRESH_LOCK_KEY = 'apple_jwks_refresh_lock';

    private const REFRESH_LOCK_TTL = 60;

    /**
     * @throws AppleSignInException
     */
    public function getPublicKey(string $keyId): Key
    {
        $jwks = Cache::get(self::CACHE_KEY);

        if (! $this->isUsableKeySet($jwks)) {
            $jwks = $this->download();
        } elseif (! $this->findJwk($jwks, $keyId) && Cache::add(self::REFRESH_LOCK_KEY, true, self::REFRESH_LOCK_TTL)) {
            try {
                $jwks = $this->download();
            } catch (AppleSignInException) {
                // Se conserva el set cacheado: el kid sigue sin existir y el
                // token se rechaza abajo como inválido.
            }
        }

        $jwk = $this->findJwk($jwks, $keyId);

        if (! $jwk) {
            throw AppleSignInException::invalidToken();
        }

        try {
            $key = JWK::parseKey($jwk, 'RS256');
        } catch (Throwable $e) {
            throw AppleSignInException::invalidToken($e::class);
        }

        // Apple firma con RS256: cualquier otro algoritmo declarado se rechaza
        // (evita confusiones de algoritmo aunque el JWKS cambiara).
        if (! $key instanceof Key || $key->getAlgorithm() !== 'RS256') {
            throw AppleSignInException::invalidToken();
        }

        return $key;
    }

    /**
     * @return array{keys: list<array<string, mixed>>}
     *
     * @throws AppleSignInException
     */
    private function download(): array
    {
        try {
            $response = Http::acceptJson()->timeout(5)->get(AppleConfiguration::JWKS_URL);
        } catch (Throwable $e) {
            throw AppleSignInException::jwksUnavailable(0, $e::class);
        }

        $jwks = $response->successful() ? $response->json() : null;

        if (! $this->isUsableKeySet($jwks)) {
            throw AppleSignInException::jwksUnavailable($response->status());
        }

        Cache::put(self::CACHE_KEY, $jwks, self::CACHE_TTL);

        return $jwks;
    }

    private function isUsableKeySet(mixed $jwks): bool
    {
        return is_array($jwks) && isset($jwks['keys']) && is_array($jwks['keys']) && $jwks['keys'] !== [];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function findJwk(array $jwks, string $keyId): ?array
    {
        foreach ($jwks['keys'] as $jwk) {
            if (is_array($jwk) && isset($jwk['kid']) && is_string($jwk['kid']) && hash_equals($jwk['kid'], $keyId)) {
                return $jwk;
            }
        }

        return null;
    }
}
