<?php

namespace Shardevcom\Repositories\Tests\Repositories;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;
use Shardevcom\Repositories\Repository;
use Shardevcom\Repositories\Tests\Models\TestModel;

class HookedTestRepository extends Repository
{
    public array $hooks = [];

    protected array $filterableFields = ['id', 'name', 'description'];
    protected array $sortableFields = ['id', 'name', 'created_at'];
    protected array $searchableFields = ['name', 'description'];

    protected function beforeFetch(array $query): void
    {
        $this->hooks[] = 'beforeFetch';
    }

    protected function afterFetch(Collection $result, array $query): Collection
    {
        $this->hooks[] = 'afterFetch';

        return $result->reject(fn (TestModel $model) => $model->name === 'Hidden')->values();
    }

    protected function beforeFetchMany(array $params): void
    {
        $this->hooks[] = 'beforeFetchMany';
    }

    protected function afterFetchMany(LengthAwarePaginator|Collection $result, array $params): LengthAwarePaginator|Collection
    {
        $this->hooks[] = 'afterFetchMany';

        return $result;
    }

    protected function beforeFind(string|int $id, array $query): void
    {
        $this->hooks[] = 'beforeFind';
    }

    protected function afterFind(?Model $model, array $query): ?Model
    {
        $this->hooks[] = 'afterFind';

        return $model;
    }

    protected function beforeBuildQuery(Builder $query, array $params): Builder
    {
        $this->hooks[] = 'beforeBuildQuery';

        return $query;
    }

    protected function applyOnFilter(Builder $builtQuery, Builder $query): Builder
    {
        $this->hooks[] = 'applyOnFilter';

        return $builtQuery;
    }

    protected function afterBuildQuery(Builder $builtQuery, array $params): Builder
    {
        $this->hooks[] = 'afterBuildQuery';

        return $builtQuery;
    }

    protected function beforeInsert(array $data): array
    {
        $this->hooks[] = 'beforeInsert';
        $data['name'] .= ' before insert';

        return $data;
    }

    protected function applyOnInsert(array $data): array
    {
        $this->hooks[] = 'applyOnInsert';
        $data['description'] = 'applied on insert';

        return $data;
    }

    protected function afterInsert(Model $model, array $data): void
    {
        $this->hooks[] = 'afterInsert';
    }

    protected function beforeUpdate(array $data, Model $model): array
    {
        $this->hooks[] = 'beforeUpdate';
        $data['name'] .= ' before update';

        return $data;
    }

    protected function applyOnUpdate(array $data, Model $model): array
    {
        $this->hooks[] = 'applyOnUpdate';
        $data['description'] = 'applied on update';

        return $data;
    }

    protected function afterUpdate(Model $model, array $data): void
    {
        $this->hooks[] = 'afterUpdate';
    }

    protected function beforeUpdateMany(array $items): void
    {
        $this->hooks[] = 'beforeUpdateMany';
    }

    protected function afterUpdateMany(Collection $updated, array $items): Collection
    {
        $this->hooks[] = 'afterUpdateMany';

        return $updated;
    }

    protected function beforeDelete(Model $model): void
    {
        $this->hooks[] = 'beforeDelete';
    }

    protected function applyOnDelete(bool $canDelete, Model $model): bool
    {
        $this->hooks[] = 'applyOnDelete';

        return $model->description !== 'keep';
    }

    protected function afterDelete(Model $model, bool $deleted): void
    {
        $this->hooks[] = 'afterDelete';
    }

    protected function beforeDeleteMany(array $ids): void
    {
        $this->hooks[] = 'beforeDeleteMany';
    }

    protected function afterDeleteMany(int $count, array $ids): int
    {
        $this->hooks[] = 'afterDeleteMany';

        return $count;
    }

    protected function beforeUpsert(array $rows, array $uniqueBy, ?array $update = null): array
    {
        $this->hooks[] = 'beforeUpsert';

        return array_map(function (array $row) {
            $row['name'] .= ' before upsert';

            return $row;
        }, $rows);
    }

    protected function applyOnUpsert(array $rows): array
    {
        $this->hooks[] = 'applyOnUpsert';

        return array_map(function (array $row) {
            $row['description'] = 'applied on upsert';

            return $row;
        }, $rows);
    }

    protected function afterUpsert(int $count, array $rows, array $uniqueBy, ?array $update = null): void
    {
        $this->hooks[] = 'afterUpsert';
    }

    protected function beforeUpdateOrCreate(array $attributes, array $values): void
    {
        $this->hooks[] = 'beforeUpdateOrCreate';
    }

    protected function afterUpdateOrCreate(Model $model, array $attributes, array $values): void
    {
        $this->hooks[] = 'afterUpdateOrCreate';
    }

    protected function beforeFirstOrCreate(array $attributes, array $values): void
    {
        $this->hooks[] = 'beforeFirstOrCreate';
    }

    protected function afterFirstOrCreate(Model $model, array $attributes, array $values): void
    {
        $this->hooks[] = 'afterFirstOrCreate';
    }

    protected function beforeFirstOrNew(array $attributes, array $values): void
    {
        $this->hooks[] = 'beforeFirstOrNew';
    }

    protected function afterFirstOrNew(Model $model, array $attributes, array $values): void
    {
        $this->hooks[] = 'afterFirstOrNew';
    }
}
