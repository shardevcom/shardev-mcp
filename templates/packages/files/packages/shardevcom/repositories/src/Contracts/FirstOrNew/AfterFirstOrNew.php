<?php

namespace Shardevcom\Repositories\Contracts\FirstOrNew;

use Illuminate\Database\Eloquent\Model;

interface AfterFirstOrNew
{
    public function afterFirstOrNew(
        Model $model,
        array $attributes,
        array $values
    ): void;
}
