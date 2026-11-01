<?php

namespace Shardevcom\Repositories\Contracts\Update;

use Illuminate\Database\Eloquent\Model;

interface BeforeUpdate
{
    public function beforeUpdate(
        array $data,
        Model $model
    ): array;
}
