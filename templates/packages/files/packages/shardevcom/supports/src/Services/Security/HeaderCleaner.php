<?php

namespace Shardevcom\Supports\Services\Security;

use Shardevcom\Supports\Contracts\HeaderCleanerInterface;
use Shardevcom\Supports\Contracts\SecurityConfigInterface;

class HeaderCleaner implements HeaderCleanerInterface
{
    public function __construct(protected SecurityConfigInterface $config) {}

    public function clean(): void
    {
        foreach ($this->config->unwantedHeaders() as $header) {
            header_remove($header);
        }
    }
}
