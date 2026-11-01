<?php

namespace Shardevcom\Supports\Contracts;

use Symfony\Component\HttpFoundation\Response;

interface HeaderSetterInterface
{
    public function apply(Response $response): void;
}
