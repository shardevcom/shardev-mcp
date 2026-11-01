<?php

namespace Shardevcom\Repositories\Contracts;

use Illuminate\Database\Eloquent\Model;

interface WithMutableRepository
{
    public function insert(array $data): Model;
    public function create(array $data): Model;
    public function update(string|int $id, array $data): Model;
    public function remove(string|int $id): bool;
    public function delete(string|int $id): bool;
}
