<?php

namespace Shardevcom\Repositories\Contracts\Update;

use Illuminate\Database\Eloquent\Model;

interface ApplyOnUpdate
{
    public function applyOnUpdate(
        array $data,
        Model $model
    ): array;
}
