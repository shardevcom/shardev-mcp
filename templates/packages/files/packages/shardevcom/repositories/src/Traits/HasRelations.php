<?php

namespace Shardevcom\Repositories\Traits;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Collection;

trait HasRelations
{
    protected function syncRelations(Model $model, array &$data): void
    {
        $relations = $this->getValidRelations($data);

        if ($relations->isEmpty()) {
            return;
        }

        foreach ($relations as $relationName) {
            $this->syncRelation($model, $relationName, $data[$relationName], $data);
        }
    }

    protected function getValidRelations(array $data): Collection
    {
        return collect($this->allowedIncludes)
            ->filter(fn($key) => isset($data[$key]) && is_array($data[$key]) && method_exists($this->model, $key));
    }

    protected function syncRelation(Model $model, string $relationName, array $value, array &$data): void
    {
        $relation = $model->{$relationName}();

        $relationHandlers = [
            \Illuminate\Database\Eloquent\Relations\BelongsToMany::class => 'handleBelongsToMany',
            \Illuminate\Database\Eloquent\Relations\HasMany::class => 'handleHasMany',
            \Illuminate\Database\Eloquent\Relations\MorphMany::class => 'handleHasMany',
            \Illuminate\Database\Eloquent\Relations\BelongsTo::class => 'handleBelongsTo',
            \Illuminate\Database\Eloquent\Relations\HasOne::class => 'handleHasOne',
        ];

        foreach ($relationHandlers as $relationClass => $handler) {
            if ($relation instanceof $relationClass) {
                $this->{$handler}($relation, $value, $data, $relationName);
                break;
            }
        }
    }

    protected function handleBelongsToMany($relation, array $value, array &$data, string $relationName): void
    {
        $ids = collect($value)
            ->map(fn($item) => is_array($item) ? ($item['id'] ?? null) : $item)
            ->filter()
            ->unique()
            ->toArray();

        $relation->sync($ids);
        unset($data[$relationName]);
    }

    protected function handleHasMany($relation, array $value, array &$data, string $relationName): void
    {
        $existingIds = $relation->pluck('id')->toArray();
        $newIds = [];

        foreach ($value as $item) {
            if (!is_array($item)) continue;

            if (!empty($item['id']) && in_array($item['id'], $existingIds)) {
                $relation->find($item['id'])->update($item);
                $newIds[] = $item['id'];
            } else {
                $newModel = $relation->create($item);
                $newIds[] = $newModel->id;
            }
        }

        $this->deleteMissingRelations($relation, $existingIds, $newIds);
        unset($data[$relationName]);
    }

    protected function deleteMissingRelations($relation, array $existingIds, array $newIds): void
    {
        $toDelete = array_diff($existingIds, $newIds);
        if (!empty($toDelete)) {
            $relation->whereIn('id', $toDelete)->delete();
        }
    }

    protected function handleBelongsTo($relation, array $value, array &$data, string $relationName): void
    {
        if (is_array($value) && isset($value['id'])) {
            $data[$relation->getForeignKeyName()] = $value['id'];
        }
        unset($data[$relationName]);
    }

    protected function handleHasOne($relation, array $value, array &$data, string $relationName): void
    {
        $related = $relation->first();
        $related ? $related->update($value) : $relation->create($value);
        unset($data[$relationName]);
    }
}
