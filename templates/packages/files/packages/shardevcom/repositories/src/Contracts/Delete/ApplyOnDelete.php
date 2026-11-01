<?php

namespace Shardevcom\Repositories\Contracts\Delete;

use Illuminate\Database\Eloquent\Model;

interface ApplyOnDelete
{
    public function applyOnDelete(bool $canDelete, Model $model): bool;
}
