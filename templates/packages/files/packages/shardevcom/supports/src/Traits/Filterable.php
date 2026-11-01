<?php

namespace Shardevcom\Supports\Traits;

use Illuminate\Database\Eloquent\Builder;

trait Filterable
{
    /**
     * Apply filters to the query builder
     *
     * @param Builder $query
     * @param array $filters
     * @return Builder
     */
    public function scopeFilter(Builder $query, array $filters): Builder
    {
        foreach ($filters as $field => $value) {
            if (method_exists($this, 'filter' . ucfirst($field))) {
                $query = $this->{'filter' . ucfirst($field)}($query, $value);
                continue;
            }

            if (in_array($field, $this->filterable ?? [])) {
                $query->where($field, $value);
            }
        }

        return $query;
    }

    /**
     * Apply sorting to the query builder
     *
     * @param Builder $query
     * @param array $sort
     * @return Builder
     */
    public function scopeSort(Builder $query, array $sort): Builder
    {
        foreach ($sort as $field => $direction) {
            if (in_array($field, $this->sortable ?? [])) {
                $query->orderBy($field, $direction);
            }
        }

        return $query;
    }
}
