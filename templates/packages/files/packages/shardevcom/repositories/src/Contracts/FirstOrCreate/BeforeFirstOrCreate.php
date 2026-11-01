<?php

namespace Shardevcom\Repositories\Contracts\FirstOrCreate;

interface BeforeFirstOrCreate
{
    public function beforeFirstOrCreate(array $attributes, array $values): void;
}
