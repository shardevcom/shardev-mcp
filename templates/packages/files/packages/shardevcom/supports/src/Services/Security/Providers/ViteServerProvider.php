<?php

namespace Shardevcom\Supports\Services\Security\Providers;

use Shardevcom\Supports\Contracts\CspServerProviderInterface;

class ViteServerProvider implements CspServerProviderInterface
{
    public function getServers(): array
    {
        $servers = [];

        // Servidor(es) de Vite actualmente en ejecución. Cada app (web/adm)
        // corre su propio `vite dev` con su propio hotFile (public/hot-web,
        // public/hot-adm — ver vite.web.config.ts / vite.adm.config.ts), en
        // vez del único `public/hot` que Laravel usa por defecto, para que
        // ambos dev servers no se pisen. Se leen todos los hot-* (y el
        // `hot` plano, por compatibilidad) en lugar de uno solo fijo.
        foreach (glob(public_path('hot*')) ?: [] as $hotFile) {
            if (!is_file($hotFile)) {
                continue;
            }

            $origin = rtrim(trim(file_get_contents($hotFile)), '/');

            if ($server = $this->parseOrigin($origin)) {
                $servers[] = $server;
            }
        }

        // Host configurado
        if ($host = config('security.servers.vite.host')) {
            $servers[] = $this->buildServer($host, config('security.servers.vite.port', 5173));
        }

        // Direcciones IP locales
        foreach ($this->getLocalAddresses() as $ip) {
            $servers[] = $this->buildServer($ip, config('security.servers.vite.port', 5173));
        }

        return array_values(array_unique($servers, SORT_REGULAR));
    }

    protected function buildServer(string $host, int $port): array
    {
        $https = config('security.servers.vite.https', false);
        return [
            'http'  => $https ? null : "http://{$host}:{$port}",
            'https' => $https ? "https://{$host}:{$port}" : null,
            'ws'    => $https ? null : "ws://{$host}:{$port}",
            'wss'   => $https ? "wss://{$host}:{$port}" : null,
        ];
    }

    protected function parseOrigin(string $origin): ?array
    {
        $origin = rtrim(trim($origin), '/');

        $parts = parse_url($origin);

        if (! isset($parts['host'], $parts['port'], $parts['scheme'])) {
            return null;
        }

        $host = $this->normalizeHost($parts['host']);

        $server = [
            'http' => null,
            'https' => null,
            'ws' => null,
            'wss' => null,
        ];

        if ($parts['scheme'] === 'https') {
            $server['https'] = "https://{$host}:{$parts['port']}";
            $server['wss'] = "wss://{$host}:{$parts['port']}";
        } else {
            $server['http'] = "http://{$host}:{$parts['port']}";
            $server['ws'] = "ws://{$host}:{$parts['port']}";
        }

        return $server;
    }

    protected function getLocalAddresses(): array
    {
        $addresses = [];

        $hostname = gethostname();

        if ($hostname !== false) {
            $ips = gethostbynamel($hostname);

            if ($ips !== false) {
                $addresses = array_merge($addresses, $ips);
            }
        }

        // Agregar localhost siempre
        $addresses[] = '127.0.0.1';
        $addresses[] = 'localhost';

        return array_values(array_unique(array_filter($addresses, function ($ip) {
            return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4);
        })));
    }

    protected function normalizeHost(string $host): string
    {
        if (in_array($host, ['0.0.0.0', '::', '[::]'])) {
            return request()->getHost();
        }

        return $host;
    }

    public function isEnabled(): bool
    {
        return app()->environment('local');
    }
}
