<?php

namespace Shardevcom\Repositories;

use Exception;
use Throwable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Pagination\LengthAwarePaginator;

use Shardevcom\Repositories\Traits\HasQueries;
use Shardevcom\Repositories\Traits\HasRelations;
use Shardevcom\Repositories\Traits\HasMutations;
use Shardevcom\Repositories\Traits\HasConfigurable;

use Shardevcom\Repositories\Contracts\RepositoryInterface;
use Shardevcom\Repositories\Contracts\WithBatchRepository;
use Shardevcom\Repositories\Contracts\WithMutableRepository;
use Shardevcom\Repositories\Contracts\WithQueryableRepository;

use Shardevcom\Supports\Helpers\HookHelper;

class Repository implements
    RepositoryInterface,
    WithBatchRepository,
    WithMutableRepository,
    WithQueryableRepository
{
    use HasConfigurable;
    use HasRelations;
    use HasMutations;
    use HasQueries;

    /**
     * Modelo asociado
     */
    protected Model $model;

    public function __construct(Model $model)
    {
        $this->model = $model;
        if ($this->isModelReady()) {
            $this->initializeConfig();
        }
    }



    /*
    |--------------------------------------------------------------------------
    | isModelReady
    | Verifica si el modelo está completamente inicializado y listo
    |--------------------------------------------------------------------------
    */
    protected function isModelReady(): bool
    {
        try {
            // Verificar que el modelo existe
            if (!$this->model || !($this->model instanceof Model)) {
                return false;
            }

            // Verificar que tiene conexión a base de datos
            if (!$this->model->getFillable()) {
                return false;
            }

            return true;
        } catch (\Exception $e) {
            return false;
        }
    }

    /*
    |--------------------------------------------------------------------------
    | Fetch
    |--------------------------------------------------------------------------
    */
    public function fetch(array $query = []): Collection
    {
        HookHelper::run(
            $this,
            'beforeFetch',
            $query
        );

        $builder = $this->buildQuery($query);

        $result = $builder->get();

        return HookHelper::pipe(
            $this,
            'afterFetch',
            $result,
            $query
        );
    }

    public function fetchMany(
        array $params = []
    ): LengthAwarePaginator|Collection {
        HookHelper::run(
            $this,
            'beforeFetchMany',
            $params
        );

        $builder = $this->buildQuery($params);

        $result = isset($params['pagination'])
            ? $builder->paginate(
                $params['pagination']['perPage'] ?? 15,
                ['*'],
                'page',
                $params['pagination']['page'] ?? 1
            )
            : $builder->get();

        return HookHelper::pipe(
            $this,
            'afterFetchMany',
            $result,
            $params
        );
    }

    public function find(
        string|int $id,
        array $query = []
    ): ?Model {
        HookHelper::run(
            $this,
            'beforeFind',
            $id,
            $query
        );

        $builder = $this->buildQuery($query);

        $model = $builder->find($id);

        return HookHelper::pipe(
            $this,
            'afterFind',
            $model,
            $query
        );
    }

    public function updateMany(array $items): Collection
    {
        HookHelper::run(
            $this,
            'beforeUpdateMany',
            $items
        );

        $updated = collect();

        DB::transaction(function () use ($items, &$updated) {

            foreach ($items as $data) {

                if (empty($data['id'])) {
                    continue;
                }

                $model = $this->model->find($data['id']);

                if (!$model) {
                    continue;
                }

                $data = HookHelper::pipe(
                    $this,
                    'applyOnUpdate',
                    $data,
                    $model
                );

                $model->update(
                    $this->safeAttributes((array) $data)
                );

                $updated->push(
                    $model->fresh()
                );
            }
        });

        return HookHelper::pipe(
            $this,
            'afterUpdateMany',
            $updated,
            $items
        );
    }

    public function deleteMany(array $ids): int
    {
        HookHelper::run(
            $this,
            'beforeDeleteMany',
            $ids
        );

        if (empty($ids)) {
            return 0;
        }

        $count = 0;

        try {

            DB::transaction(function () use ($ids, &$count) {

                $records = $this->model
                    ->whereIn('id', $ids)
                    ->get();

                foreach ($records as $model) {

                    $canDelete = HookHelper::pipe(
                        $this,
                        'applyOnDelete',
                        true,
                        $model
                    );

                    if ($canDelete === false) {
                        continue;
                    }

                    if ($model->delete()) {
                        $count++;
                    }
                }
            });

        } catch (Throwable $e) {

            report($e);

            throw new Exception(
                "Error deleting records: {$e->getMessage()}",
                0,
                $e
            );
        }

        return HookHelper::pipe(
            $this,
            'afterDeleteMany',
            $count,
            $ids
        );
    }

    public function getModel(): Model
    {
        return $this->model;
    }

    public function newQuery(): Builder
    {
        return $this->model->newQuery();
    }

    public function findBy(
        string $field,
        mixed $value
    ): ?Model {
        return $this->model
            ->where($field, $value)
            ->first();
    }

    public function getResource(): string
    {
        return $this->model->getTable();
    }
}
