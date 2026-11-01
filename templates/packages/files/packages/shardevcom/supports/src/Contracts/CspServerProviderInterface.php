<?php

namespace Shardevcom\Supports\Contracts;

interface CspServerProviderInterface
{
    /**
     * Devuelve los hosts relevantes para el CSP.
     *
     * @return array{ws: string, wss: string, https: string}
     */
    public function getServers(): array;

    /**
     * Determina si este proveedor debe ser incluido según el entorno o config.
     */
    public function isEnabled(): bool;
}

