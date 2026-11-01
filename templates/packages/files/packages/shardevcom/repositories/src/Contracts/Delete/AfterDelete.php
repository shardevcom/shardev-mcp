<?php

namespace Shardevcom\Repositories\Contracts\Delete;

use Illuminate\Database\Eloquent\Model;

interface AfterDelete
{
    public function afterDelete(
        Model $model,
        bool $deleted
    ): void;
}
