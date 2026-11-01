<?php

namespace Shardevcom\Repositories\Traits;
use Illuminate\Support\Facades\Config;

trait HasConfigurable
{
    /*
    |--------------------------------------------------------------------------
    | Manual Overrides
    |--------------------------------------------------------------------------
    */

    protected array $filterableFields = [];

    protected array $sortableFields = [];

    protected array $allowedIncludes = [];

    protected array $hiddenIncludes = [];

    protected array $allowedFields = [];

    protected array $hiddenFields = [];

    protected array $searchableFields = [];

    protected bool $forceFilter = false;

    protected bool $isConfigInitialized = false;

    /*
    |--------------------------------------------------------------------------
    | Boot Config
    |--------------------------------------------------------------------------
    */

    protected function initializeConfig(): void
    {
        $config = Config::get('repositories', []);

        /*
        |--------------------------------------------------------------------------
        | Base Discovery
        |--------------------------------------------------------------------------
        */
        $this->allowedFields = !empty($this->allowedFields)
            ? $this->allowedFields
            : array_unique(array_filter([
                $this->model->getKeyName(),
                ...($config['fields']['allowed_fields'] ?? []),
                ...($this->model->getFillable() ?? []),
                ...($this->model->getAppends() ?? []),
                $this->model->getCreatedAtColumn(),
                $this->model->getUpdatedAtColumn(),
            ]));

        $hidden = array_unique(array_merge(
            $this->model->getHidden(),
            $this->hiddenFields,
            $config['fields']['hidden_fields'] ?? [],
        ));

        /*
        |--------------------------------------------------------------------------
        | Allowed Fields
        |--------------------------------------------------------------------------
        |
        | Auto:
        | - All columns
        | - Except hidden
        |
        */
        $this->allowedFields = array_values(array_diff(
            $this->allowedFields,
            $hidden
        ));

        /*
        |--------------------------------------------------------------------------
        | Filterable
        |--------------------------------------------------------------------------
        |
        | Default:
        | All visible columns
        |
        */

        $this->filterableFields = $this->filterableFields
            ?: $this->allowedFields;

        /*
        |--------------------------------------------------------------------------
        | Sortable
        |--------------------------------------------------------------------------
        |
        | Default:
        | All visible columns
        |
        */

        $this->sortableFields = $this->sortableFields
            ?: $this->allowedFields;

        /*
        |--------------------------------------------------------------------------
        | Includes
        |--------------------------------------------------------------------------
        |
        | Auto discover relations
        | Except hidden includes
        |
        */
        $this->allowedIncludes = array_unique(
            $this->allowedIncludes
        );

        $this->allowedIncludes = array_values(array_diff(
            $this->allowedIncludes,
            $this->hiddenIncludes
        ));

        /*
        |--------------------------------------------------------------------------
        | Searchable
        |--------------------------------------------------------------------------
        |
        | Manual only.
        | Search is expensive and contextual.
        |
        */

        $this->searchableFields = array_unique(
            $this->searchableFields
        );

        /*
        |--------------------------------------------------------------------------
        | Force Filter
        |--------------------------------------------------------------------------
        */

        $this->forceFilter = $config['filters']['force_filter'] ?? false;

        /*
        |--------------------------------------------------------------------------
        | Hidden Fields
        |--------------------------------------------------------------------------
        */

        $this->hiddenFields = $hidden;

        $this->isConfigInitialized = true;
    }

    /*
    |--------------------------------------------------------------------------
    | Resolve Query Fields
    |--------------------------------------------------------------------------
    */

    protected function fields(?array $fields = null): array
    {
        $fields ??= $this->allowedFields;

        $fields = array_intersect(
            $fields,
            $this->allowedFields
        );

        $fields = array_diff(
            $fields,
            $this->hiddenFields
        );

        /*
        |--------------------------------------------------------------------------
        | Always Include Primary Key
        |--------------------------------------------------------------------------
        */

        $primaryKey = $this->model->getKeyName();

        if (!in_array($primaryKey, $fields)) {
            $fields[] = $primaryKey;
        }

        return array_values(array_unique($fields));
    }

    /**
     * Expone allowedFields públicamente para que BaseExport pueda acceder
     * sin recurrir a Reflection. PHP 8.3 devuelve null al leer propiedades
     * protected desde fuera de la clase, lo que rompe BaseExport::getExportableFields().
     */
    public function getAllowedFieldsList(): array
    {
        return $this->allowedFields;
    }
}
