<?php

namespace Shardevcom\Repositories\Contracts\FirstOrNew;

interface BeforeFirstOrNew
{
    public function beforeFirstOrNew(
        array $attributes,
        array $values
    ): void;
}
