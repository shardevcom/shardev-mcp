<?php

namespace Shardevcom\Repositories\Builders;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Schema;
use InvalidArgumentException;
use Shardevcom\Supports\Helpers\ListHelper;

class QueryBuilder
{
    public function __construct(
        private Builder $query,
        private array $filterableFields = [],
        private array $sortableFields = [],
        private array $allowedIncludes = [],
        private array $searchableFields = [],
        private array $allowedFields = [],
        private array $hiddenFields = [],
        private bool $forceFilter = false
    ) {
    }

    public function build(array $params = []): Builder
    {
        if ($this->forceFilter && empty($params['filter'])) {
            throw new InvalidArgumentException('At least one filter is required for this repository query.');
        }

        return $this->applyFilters((array) ($params['filter'] ?? []))
            ->applySorting((array) ($params['sort'] ?? []))
            ->applyIncludes((array) ($params['include'] ?? []))
            ->applySearch($params['search'] ?? null)
            ->applyFieldSelection(isset($params['fields']) ? (array) $params['fields'] : null)
            ->query;
    }

    protected function applyFilters(array $filters): self
    {
        foreach ($filters as $field => $value) {
            if (in_array($field, $this->filterableFields, true)) {
                $this->applyFilter($field, $value);
                continue;
            }

            if (str_contains($field, '.')) {
                $this->applyRelationFilter($field, $value);
            }
        }

        return $this;
    }

    protected function applyFilter(string $field, mixed $value): void
    {
        $this->applyFilterToQuery($this->query, $field, $value);
    }

    protected function applyFilterToQuery(Builder $query, string $field, mixed $value): void
    {
        if (is_null($value) || $value === '') {
            return;
        }

        if (is_array($value)) {
            if (isset($value['between']) && is_array($value['between']) && count($value['between']) === 2) {
                $query->whereBetween($field, $value['between']);
                return;
            }

            if (isset($value['in'])) {
                $query->whereIn($field, (array) $value['in']);
                return;
            }

            if (isset($value['not_in'])) {
                $query->whereNotIn($field, (array) $value['not_in']);
                return;
            }

            $query->whereIn($field, $value);
            return;
        }

        if ($value === 'null') {
            $query->whereNull($field);
            return;
        }

        if ($value === 'not_null') {
            $query->whereNotNull($field);
            return;
        }

        if (is_string($value) && preg_match('/^(>=|<=|>|<)\s*(.+)$/', $value, $matches)) {
            $query->where($field, $matches[1], $matches[2]);
            return;
        }

        if (is_string($value) && strpbrk($value, '%*') !== false) {
            $query->where($field, 'LIKE', str_replace('*', '%', $value));
            return;
        }

        $query->where($field, $value);
    }

    protected function applyRelationFilter(string $field, mixed $value): void
    {
        [$relation, $column] = explode('.', $field, 2);

        if (!in_array($relation, $this->allowedIncludes, true)) {
            return;
        }

        $this->query->whereHas($relation, function (Builder $query) use ($column, $value) {
            $this->applyFilterToQuery($query, $column, $value);
        });
    }

    protected function applySorting(array $sorts): self
    {
        if (empty($sorts)) {
            return $this;
        }

        if (isset($sorts['field'])) {
            $sorts = [$sorts];
        }

        foreach ($sorts as $sort) {
            $field = $sort['field'] ?? null;

            if (!$field || !in_array($field, $this->sortableFields, true)) {
                continue;
            }

            $direction = strtolower($sort['order'] ?? 'asc');
            $this->query->orderBy($field, $direction === 'desc' ? 'desc' : 'asc');
        }

        return $this;
    }

    protected function applyIncludes(array $includes): self
    {
        $includes = $this->normalizeList($includes);
        $validIncludes = array_intersect($includes, $this->allowedIncludes);

        if (!empty($validIncludes)) {
            $this->query->with($validIncludes);
        }

        return $this;
    }

    protected function applySearch(mixed $search): self
    {
        if (!is_string($search) || $search === '' || empty($this->searchableFields)) {
            return $this;
        }

        $this->query->where(function (Builder $sub) use ($search) {
            foreach ($this->searchableFields as $field) {
                if (str_contains($field, '.')) {
                    [$relation, $column] = explode('.', $field, 2);

                    if (in_array($relation, $this->allowedIncludes, true)) {
                        $sub->orWhereHas($relation, function (Builder $q) use ($column, $search) {
                            $q->where($column, 'LIKE', "%{$search}%");
                        });
                    }

                    continue;
                }

                $sub->orWhere($field, 'LIKE', "%{$search}%");
            }
        });

        return $this;
    }

    protected function applyFieldSelection(?array $requestedFields): self
    {
        $fields = $this->resolveFields($requestedFields ? $this->normalizeList($requestedFields) : null);

        if (!empty($fields)) {
            $this->query->select($fields);
        }

        return $this;
    }

    protected function resolveFields(?array $requestedFields): array
    {
        $model = $this->query->getModel();
        $table = $model->getTable();
        $primaryKey = $model->getKeyName();

        if (!$requestedFields) {
            $requestedFields = Schema::getColumnListing($table);
        }

        $fields = array_intersect($requestedFields, $this->allowedFields ?: $requestedFields);
        $fields = array_diff($fields, $this->hiddenFields);

        if (!in_array($primaryKey, $fields)) {
            $fields[] = $primaryKey;
        }

        return array_values($fields);
    }

    protected function normalizeList(array $items): array
    {
        return ListHelper::normalize($items);
    }
}
