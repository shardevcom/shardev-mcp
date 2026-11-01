<?php

namespace Shardevcom\Integrations\Services\Microsoft;

use Exception;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Shardevcom\Supports\Helpers\LogSanitizer;

/**
 * Resuelve la configuración de descubrimiento OIDC de Microsoft Entra ID
 * (jwks_uri, issuer) para el tenant configurado en `services.microsoft.tenant`
 * ("consumers" = cuentas Microsoft personales).
 */
class MicrosoftOidcConfiguration
{
    private const CACHE_KEY_PREFIX = 'microsoft_oidc_configuration_';
    private const CACHE_TTL = 3600; // 1 hora

    // GUID fijo que Microsoft usa como tenant real para cuentas personales
    // ("consumers"). Solo se usa como fallback si el discovery document no
    // trae "issuer" explícito.
    private const CONSUMER_TENANT_ID = '9188040d-6c67-4c5b-b112-36a304b66dad';

    public function getConfiguration(): array
    {
        $tenant = $this->tenant();

        return Cache::remember(self::CACHE_KEY_PREFIX . $tenant, self::CACHE_TTL, function () use ($tenant) {
            try {
                $url = "https://login.microsoftonline.com/{$tenant}/v2.0/.well-known/openid-configuration";
                $response = Http::get($url);

                return $response->json() ?? [];
            } catch (Exception $e) {
                Log::error('Error fetching Microsoft OIDC configuration: ' . LogSanitizer::sanitize($e->getMessage()));
                throw new Exception('Failed to fetch Microsoft OIDC configuration');
            }
        });
    }

    public function getJwksUri(): string
    {
        $config = $this->getConfiguration();

        return $config['jwks_uri'] ?? "https://login.microsoftonline.com/{$this->tenant()}/discovery/v2.0/keys";
    }

    public function getIssuer(): string
    {
        $config = $this->getConfiguration();

        // Para un tenant concreto como "consumers", el discovery document ya
        // devuelve un issuer sin plantilla ({tenantid}) — a diferencia de
        // "common"/"organizations", donde el issuer viene templado y
        // requeriría sustituir el tenant real de cada token. Este paquete usa
        // "consumers" de forma fija, así que ese caso no aplica aquí.
        return $config['issuer'] ?? 'https://login.microsoftonline.com/' . self::CONSUMER_TENANT_ID . '/v2.0';
    }

    protected function tenant(): string
    {
        return config('services.microsoft.tenant', 'consumers');
    }
}
