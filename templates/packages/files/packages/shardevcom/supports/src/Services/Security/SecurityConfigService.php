<?php

namespace Shardevcom\Supports\Services\Security;

use Illuminate\Contracts\Config\Repository as Config;
use Shardevcom\Supports\Contracts\SecurityConfigInterface;
use Shardevcom\Supports\Contracts\CspServerProviderInterface;
use Shardevcom\Supports\Services\Security\Providers\ReverbServerProvider;
use Shardevcom\Supports\Services\Security\Providers\ViteServerProvider;
use Spatie\Csp\Directive;

class SecurityConfigService implements SecurityConfigInterface
{
    /**
     * @param array<CspServerProviderInterface> $providers
     */
    public function __construct(
        protected Config $config,
        protected array $providers = []
    ) {
        // Por defecto registramos Vite y Reverb (puedes agregar más)
        if (empty($this->providers)) {
            $this->providers = [
                new ViteServerProvider(),
                new ReverbServerProvider(),
            ];
        }
    }

    public function getActiveServers(): array
    {
        $servers = [];

        foreach ($this->providers as $provider) {
            if ($provider->isEnabled()) {
                // Cada provider devuelve algo como: [["ws://...", "wss://...", "https://..."], ...]
                $servers = array_merge($servers, $provider->getServers());
            }
        }

        return $servers;
    }

    public function getCspWithServers(): array
    {
        $cspConfig = config('security.content_security_policy', []);
        $servers = $this->getActiveServers();

        foreach ($servers as $server) {
            foreach ([
                         Directive::CONNECT->value => ['ws', 'wss'],
                         Directive::STYLE_ELEM->value => ['http', 'https'],
                         Directive::SCRIPT_ELEM->value => ['http', 'https'],
                     ] as $directive => $keys) {

                $cspConfig[$directive] = array_merge(
                    $cspConfig[$directive] ?? [],
                    array_filter(array_map(
                        fn ($key) => $server[$key] ?? null,
                        $keys
                    ))
                );
            }
        }

        return $cspConfig;
    }

    public function isCspReportOnly(): bool
    {
        return config('security.content_security_policy_report_only', false);
    }

    public function headers(): array
    {
        return $this->config->get('security.security_headers', []);
    }

    public function unwantedHeaders(): array
    {
        return $this->config->get('security.security_header_unwanted_headers', []);
    }

    public function optionsToString(): array
    {
        return $this->config->get('security.security_header_options_to_string', []);
    }
}
