<?php

namespace Shardevcom\Repositories\Contracts\Delete;

use Illuminate\Database\Eloquent\Model;

interface BeforeDelete
{
    public function beforeDelete(
        Model $model
    ): void;
}
