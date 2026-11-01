<?php

namespace Shardevcom\Integrations\Services\Google;

use Exception;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Shardevcom\Supports\Helpers\LogSanitizer;

/**
 * Resuelve la configuración de descubrimiento OIDC de Google (jwks_uri, issuer).
 * A pesar del nombre histórico ("Risc"), es infraestructura genérica de Google
 * OIDC reutilizable tanto para eventos de seguridad (RISC) como para verificar
 * id_tokens normales (login nativo).
 */
class GoogleRiscConfiguration
{
    private const RISC_CONFIG_URL = 'https://accounts.google.com/.well-known/risc-configuration';
    private const CACHE_KEY = 'google_risc_configuration';
    private const CACHE_TTL = 3600; // 1 hora

    public function getConfiguration(): array
    {
        return Cache::remember(self::CACHE_KEY, self::CACHE_TTL, function () {
            try {
                $response = Http::get(self::RISC_CONFIG_URL);

                return $response->json() ?? [];
            } catch (Exception $e) {
                Log::error('Error fetching Google RISC configuration: ' . LogSanitizer::sanitize($e->getMessage()));
                throw new Exception('Failed to fetch Google RISC configuration');
            }
        });
    }

    public function getJwksUri(): string
    {
        $config = $this->getConfiguration();
        return $config['jwks_uri'] ?? 'https://www.googleapis.com/oauth2/v3/certs';
    }

    public function getIssuer(): string
    {
        $config = $this->getConfiguration();
        return $config['issuer'] ?? 'https://accounts.google.com';
    }
}
