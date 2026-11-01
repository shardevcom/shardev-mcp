<?php

namespace Shardevcom\Supports\Services\Security\Providers;

use Shardevcom\Supports\Contracts\CspServerProviderInterface;
use Illuminate\Support\Facades\Config;

class ReverbServerProvider implements CspServerProviderInterface
{
    public function getServers(): array
    {
        $host = config('security.servers.reverb.host', 'localhost');
        $port = config('security.servers.reverb.port', '443');
        $portSuffix = ($port === 80 || $port === 443) ? "" : ":$port";

        return [
            [
                'ws' => "ws://{$host}{$portSuffix}",
                'wss' => "wss://{$host}{$portSuffix}",
                'https' => "https://{$host}{$portSuffix}",
            ]
        ];
    }

    public function isEnabled(): bool
    {
        return Config::has('reverb');
    }
}
