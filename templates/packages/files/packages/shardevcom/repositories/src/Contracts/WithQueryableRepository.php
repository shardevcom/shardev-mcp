<?php

namespace Shardevcom\Repositories\Contracts;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;

interface WithQueryableRepository
{
    public function fetch(array $query = []): Collection;
    public function fetchMany(array $params = []): LengthAwarePaginator|Collection;
    public function find(string|int $id, array $query = []): ?Model;
}
