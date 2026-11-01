<?php

namespace Shardevcom\Supports\Contracts;

interface SecurityConfigInterface
{

    public function headers(): array;
    public function unwantedHeaders(): array;
    public function optionsToString(): array;

}
