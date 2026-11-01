<?php

namespace Shardevcom\Repositories\Contracts\UpdateOrCreate;

interface BeforeUpdateOrCreate
{
    public function beforeUpdateOrCreate(
        array $attributes,
        array $values
    ): void;
}
