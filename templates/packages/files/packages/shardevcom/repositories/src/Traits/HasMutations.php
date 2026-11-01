<?php

namespace Shardevcom\Repositories\Traits;

use Illuminate\Database\Eloquent\Model;
use Shardevcom\Supports\Helpers\HookHelper;

/**
 * @template TModel of Model
 */
trait HasMutations
{
    /**
     * @param array $data
     * @return TModel
     */
    public function insert(array $data): Model
    {
        $data = HookHelper::pipe(
            $this,
            'beforeInsert',
            $data
        );

        $data = HookHelper::pipe(
            $this,
            'applyOnInsert',
            $data
        );

        $safeData = $this->safeAttributes($data);

        $model = $this->model->create($safeData);

        $this->syncRelations($model, $data);

        HookHelper::run(
            $this,
            'afterInsert',
            $model,
            $data
        );

        return $model->fresh();
    }

    /**
     * @param array $data
     * @return TModel
     */
    public function create(array $data): Model
    {
        return $this->insert($data);
    }

    /**
     * @param string|int $id
     * @param array $data
     * @return TModel
     */
    public function update(string|int $id, array $data): Model
    {
        $model = $this->model->findOrFail($id);

        $data = HookHelper::pipe(
            $this,
            'beforeUpdate',
            $data,
            $model
        );

        $data = HookHelper::pipe(
            $this,
            'applyOnUpdate',
            $data,
            $model
        );

        $safeData = $this->safeAttributes($data);

        $model->update($safeData);

        $this->syncRelations($model, $data);

        HookHelper::run(
            $this,
            'afterUpdate',
            $model,
            $data
        );

        return $model->fresh();
    }

    /**
     * @param array $rows
     * @param array $uniqueBy
     * @param array|null $update
     * @return int
     */
    public function upsert(
        array $rows,
        array $uniqueBy,
        ?array $update = null
    ): int {

        $rows = HookHelper::pipe(
            $this,
            'beforeUpsert',
            $rows,
            $uniqueBy,
            $update
        );

        $rows = HookHelper::pipe(
            $this,
            'applyOnUpsert',
            $rows,
            $uniqueBy,
            $update
        );

        $filteredRows = collect($rows)
            ->map(fn ($row) => $this->safeAttributes(
                (array) $row,
                $uniqueBy
            ))
            ->all();

        $count = $this->model->upsert(
            $filteredRows,
            $uniqueBy,
            $update
        );

        HookHelper::run(
            $this,
            'afterUpsert',
            $count,
            $rows,
            $uniqueBy,
            $update
        );

        return $count;
    }

    /**
     * @param string|int $id
     * @return bool
     */
    public function remove(string|int $id): bool
    {

        $model = $this->model->findOrFail($id);

        HookHelper::run(
            $this,
            'beforeDelete',
            $model
        );

        $canDelete = HookHelper::pipe(
            $this,
            'applyOnDelete',
            true,
            $model
        );

        if ($canDelete === false) {
            return false;
        }

        $deleted = $model->delete();

        HookHelper::run(
            $this,
            'afterDelete',
            $model,
            $deleted
        );

        return $deleted;
    }

    /**
     * @param string|int $id
     * @return bool
     */
    public function delete(string|int $id): bool
    {
        return $this->remove($id);
    }

    /**
     * @param array $attributes
     * @param array $values
     * @return TModel
     */
    public function updateOrCreate(
        array $attributes,
        array $values = []
    ): Model {
        HookHelper::run(
            $this,
            'beforeUpdateOrCreate',
            $attributes,
            $values
        );

        $model = $this->model->updateOrCreate(
            $attributes,
            $values
        );

        HookHelper::run(
            $this,
            'afterUpdateOrCreate',
            $model,
            $attributes,
            $values
        );

        return $model->fresh();
    }

    /**
     * @param array $attributes
     * @param array $values
     * @return TModel
     */
    public function firstOrCreate(
        array $attributes,
        array $values = []
    ): Model {
        HookHelper::run(
            $this,
            'beforeFirstOrCreate',
            $attributes,
            $values
        );

        $model = $this->model->firstOrCreate(
            $attributes,
            $values
        );

        HookHelper::run(
            $this,
            'afterFirstOrCreate',
            $model,
            $attributes,
            $values
        );

        return $model->fresh();
    }

    public function firstOrNew(
        array $attributes,
        array $values = []
    ): Model {
        HookHelper::run(
            $this,
            'beforeFirstOrNew',
            $attributes,
            $values
        );

        $model = $this->model->firstOrNew(
            $attributes,
            $values
        );

        HookHelper::run(
            $this,
            'afterFirstOrNew',
            $model,
            $attributes,
            $values
        );

        return $model;
    }

    protected function safeAttributes(
        array $data,
        array $extraAllowed = []
    ): array {
        $fillable = $this->model->getFillable();

        if (empty($fillable)) {
            return $data;
        }

        $allowed = array_merge(
            $fillable,
            $extraAllowed
        );

        return array_intersect_key(
            $data,
            array_flip($allowed)
        );
    }
}
