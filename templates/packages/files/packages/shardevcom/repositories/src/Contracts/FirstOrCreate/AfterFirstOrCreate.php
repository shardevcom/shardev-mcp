<?php

namespace Shardevcom\Repositories\Contracts\FirstOrCreate;
use Illuminate\Database\Eloquent\Model;

interface AfterFirstOrCreate
{
    public function afterFirstOrCreate(
        Model $model,
        array $attributes,
        array $values
    ): void;
}
