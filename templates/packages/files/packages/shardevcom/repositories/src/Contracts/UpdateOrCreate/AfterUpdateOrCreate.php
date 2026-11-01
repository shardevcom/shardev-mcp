<?php

namespace Shardevcom\Repositories\Contracts\UpdateOrCreate;

use Illuminate\Database\Eloquent\Model;

interface AfterUpdateOrCreate
{
    public function afterUpdateOrCreate(
        Model $model,
        array $attributes,
        array $values
    ): void;
}
