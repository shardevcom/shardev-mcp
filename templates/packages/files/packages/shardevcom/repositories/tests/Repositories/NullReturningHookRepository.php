<?php

namespace Shardevcom\Repositories\Tests\Repositories;

use Illuminate\Database\Eloquent\Model;
use Shardevcom\Repositories\Repository;

class NullReturningHookRepository extends Repository
{
    public array $hooks = [];

    protected function beforeUpdate(
        array $data,
        Model $model
    ): null {
        $this->hooks[] = 'beforeUpdate';

        return null;
    }

    protected function applyOnUpdate(
        array $data,
        Model $model
    ): null {
        $this->hooks[] = 'applyOnUpdate';

        return null;
    }
}
