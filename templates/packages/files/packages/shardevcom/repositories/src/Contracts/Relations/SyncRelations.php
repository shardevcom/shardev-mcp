<?php

namespace Shardevcom\Repositories\Contracts\Relations;

use Illuminate\Database\Eloquent\Model;

interface SyncRelations
{
    public function syncRelations(
        Model $model,
        array $data
    ): void;
}
