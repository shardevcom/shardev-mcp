<?php

namespace Shardevcom\Integrations\Services\Google;

use Exception;
use Firebase\JWT\JWK;
use Firebase\JWT\Key;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Shardevcom\Supports\Helpers\LogSanitizer;

class GoogleJwksService
{
    private const JWKS_CACHE_KEY = 'google_jwks';
    private const JWKS_CACHE_TTL = 3600; // 1 hora

    public function __construct(private GoogleRiscConfiguration $riscConfig)
    {
    }

    public function getPublicKey(string $keyId): Key
    {
        $jwks = $this->fetchJwks();

        foreach ($jwks['keys'] as $key) {
            if ($key['kid'] === $keyId) {
                // JWK::parseKey() ya devuelve un Firebase\JWT\Key listo para
                // usar con JWT::decode() — envolverlo en otro `new Key(...)`
                // falla, porque Key espera un string/recurso PEM como primer
                // argumento, no otro objeto Key.
                return JWK::parseKey($key);
            }
        }

        throw new Exception("Public key not found for key ID: {$keyId}");
    }

    private function fetchJwks(): array
    {
        return Cache::remember(self::JWKS_CACHE_KEY, self::JWKS_CACHE_TTL, function () {
            try {
                $jwksUri = $this->riscConfig->getJwksUri();
                $response = Http::get($jwksUri);

                return $response->json() ?? [];
            } catch (Exception $e) {
                Log::error('Error fetching Google JWKS: ' . LogSanitizer::sanitize($e->getMessage()));
                throw new Exception('Failed to fetch Google JWKS');
            }
        });
    }
}
