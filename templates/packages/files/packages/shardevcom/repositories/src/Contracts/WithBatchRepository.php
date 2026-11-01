<?php

namespace Shardevcom\Repositories\Contracts;

use Illuminate\Support\Collection;

interface WithBatchRepository
{
    public function updateMany(array $items): Collection;
    public function deleteMany(array $ids): int;
}
