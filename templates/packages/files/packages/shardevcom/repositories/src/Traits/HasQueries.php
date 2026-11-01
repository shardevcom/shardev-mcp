<?php

namespace Shardevcom\Repositories\Traits;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\SoftDeletes;
use Shardevcom\Repositories\Builders\QueryBuilder;
use Shardevcom\Supports\Helpers\HookHelper;


trait HasQueries
{
    protected function buildQuery(array $params = []): Builder
    {
        $query = $this->model->newQuery();

        $query = $this->applyTrashedFilter($query, $params);

        $query = HookHelper::pipe($this, 'beforeBuildQuery', $query, $params);

        $queryBuilder = new QueryBuilder(
            $query,
            $this->filterableFields ?? [],
            $this->sortableFields ?? [],
            $this->allowedIncludes ?? [],
            $this->searchableFields ?? [],
            $this->allowedFields ?? [],
            $this->hiddenFields ?? [],
            $this->forceFilter ?? false,
        );

        $builtQuery = $queryBuilder->build($params);

        $builtQuery = HookHelper::pipe($this, 'applyOnFilter', $builtQuery, $query);

        return HookHelper::pipe($this, 'afterBuildQuery', $builtQuery, $params);
    }

    /**
     * `filter[trashed]=only|with` → onlyTrashed()/withTrashed().
     *
     * Opt-in por repositorio: solo aplica si el repositorio declara
     * `protected bool $allowTrashedFilter = true;` y su modelo usa SoftDeletes.
     * En cualquier otro caso (o con un valor no reconocido) se ignora y se
     * mantiene el comportamiento por defecto (sin eliminados). Solo retira el
     * scope de SoftDeletes: el resto de global scopes (p.ej. `ownership_filter`
     * de HasBelongsToOwner) sigue aplicando.
     */
    protected function applyTrashedFilter(Builder $query, array $params): Builder
    {
        return match ($this->resolveTrashedFilter($params)) {
            'only' => $query->onlyTrashed(),
            'with' => $query->withTrashed(),
            default => $query,
        };
    }

    /**
     * Modo de `filter[trashed]` efectivo para esta consulta: 'only', 'with' o null.
     */
    protected function resolveTrashedFilter(array $params): ?string
    {
        $value = $params['filter']['trashed'] ?? null;

        if (! is_string($value) || ! in_array($value, ['only', 'with'], true)) {
            return null;
        }

        if (! $this->allowsTrashedFilter()) {
            return null;
        }

        if (! in_array(SoftDeletes::class, class_uses_recursive($this->model), true)) {
            return null;
        }

        return $value;
    }

    /**
     * Si el repositorio permite exponer registros eliminados vía `filter[trashed]`.
     * Los repositorios pueden sobrescribirlo para restringirlo por contexto.
     */
    protected function allowsTrashedFilter(): bool
    {
        return property_exists($this, 'allowTrashedFilter') && $this->allowTrashedFilter === true;
    }
}
