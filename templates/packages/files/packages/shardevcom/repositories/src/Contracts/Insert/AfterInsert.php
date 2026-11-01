<?php

namespace Shardevcom\Repositories\Contracts\Insert;
use Illuminate\Database\Eloquent\Model;

interface AfterInsert
{
    public function afterInsert(Model $model, array $data): void;
}
