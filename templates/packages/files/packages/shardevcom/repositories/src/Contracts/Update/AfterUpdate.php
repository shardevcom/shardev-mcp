<?php

namespace Shardevcom\Repositories\Contracts\Update;

use Illuminate\Database\Eloquent\Model;

interface AfterUpdate
{
    public function afterUpdate(
        Model $model,
        array $data
    ): void;
}
