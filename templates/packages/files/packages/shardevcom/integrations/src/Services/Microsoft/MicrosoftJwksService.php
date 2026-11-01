<?php

namespace Shardevcom\Integrations\Services\Microsoft;

use Exception;
use Firebase\JWT\JWK;
use Firebase\JWT\Key;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Shardevcom\Supports\Helpers\LogSanitizer;

class MicrosoftJwksService
{
    private const JWKS_CACHE_KEY = 'microsoft_jwks';
    private const JWKS_CACHE_TTL = 3600; // 1 hora

    public function __construct(private MicrosoftOidcConfiguration $oidcConfig)
    {
    }

    public function getPublicKey(string $keyId): Key
    {
        $jwks = $this->fetchJwks();

        foreach ($jwks['keys'] as $key) {
            if ($key['kid'] === $keyId) {
                // Microsoft publica sus claves sin el parámetro "alg" (Google sí
                // lo incluye). Sin un algoritmo por defecto, parseKey() lanza
                // 'JWK must contain an "alg" parameter' y la verificación de
                // firma nunca llega a ejecutarse: el callback nativo acababa
                // cayendo siempre al camino alternativo del access_token.
                // Los id_token de Microsoft v2.0 se firman con RS256.
                return JWK::parseKey($key, 'RS256');
            }
        }

        throw new Exception("Public key not found for key ID: {$keyId}");
    }

    private function fetchJwks(): array
    {
        return Cache::remember(self::JWKS_CACHE_KEY, self::JWKS_CACHE_TTL, function () {
            try {
                $jwksUri = $this->oidcConfig->getJwksUri();
                $response = Http::get($jwksUri);

                return $response->json() ?? [];
            } catch (Exception $e) {
                Log::error('Error fetching Microsoft JWKS: ' . LogSanitizer::sanitize($e->getMessage()));
                throw new Exception('Failed to fetch Microsoft JWKS');
            }
        });
    }
}
