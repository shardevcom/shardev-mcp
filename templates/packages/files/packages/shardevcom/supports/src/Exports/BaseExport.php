<?php

namespace Shardevcom\Supports\Exports;

use Illuminate\Support\Collection;
use Illuminate\Support\Str;
use Maatwebsite\Excel\Concerns\FromCollection;
use Maatwebsite\Excel\Concerns\ShouldAutoSize;
use Maatwebsite\Excel\Concerns\WithHeadings;
use Maatwebsite\Excel\Concerns\WithMapping;

abstract class BaseExport implements FromCollection, WithHeadings, WithMapping, ShouldAutoSize
{
    protected mixed $repository;
    protected array $filters;
    protected array $customHeadings = [];

    public function __construct(mixed $repository, array $filters = [])
    {
        $this->repository = $repository;
        $this->filters = $filters;
    }

    /**
     * Campos a exportar. Soporta columnas directas ('name') y relaciones ('integration.name').
     */
    public function getExportableFields(): array
    {
        // Intentamos primero el método público (evita el problema de PHP 8.3 donde
        // acceder a propiedades protected desde fuera de la clase devuelve null).
        if (method_exists($this->repository, 'getAllowedFieldsList')) {
            $fields = $this->repository->getAllowedFieldsList();
            if (!empty($fields)) {
                return $fields;
            }
        }

        // Fallback: acceso directo (solo funciona si la propiedad es pública)
        if (property_exists($this->repository, 'allowedFields') && !empty($this->repository->allowedFields)) {
            return $this->repository->allowedFields;
        }

        return ['*'];
    }

    public function collection(): Collection
    {
        $safeFilters = $this->sanitizeFilters($this->filters);

        // 1. Cargar relaciones permitidas automáticamente para evitar problemas N+1
        if (property_exists($this->repository, 'allowedIncludes') && !empty($this->repository->allowedIncludes)) {
            $includes = is_array($this->repository->allowedIncludes)
                ? implode(',', $this->repository->allowedIncludes)
                : $this->repository->allowedIncludes;

            $safeFilters['include'] = $includes;
        }

        $results = $this->repository->fetch($safeFilters);

        return $results instanceof Collection ? $results : collect($results);
    }

    public function headings(): array
    {
        if (!empty($this->customHeadings)) {
            return $this->customHeadings;
        }

        return array_map(function ($field) {
            // Convierte 'integration.name' en 'Integration Name'
            $cleanField = str_replace(['.', '_'], ' ', $field);
            return Str::title($cleanField);
        }, $this->getExportableFields());
    }

    public function map($row): array
    {
        $fields = $this->getExportableFields();
        $mappedRow = [];

        foreach ($fields as $field) {
            // data_get resuelve relaciones anidadas como $row->integration->name
            $value = data_get($row, $field);

            $mappedRow[] = match (true) {
                is_bool($value) => $value ? 'Activo' : 'Inactivo',
                $value instanceof \DateTimeInterface => $value->format('Y-m-d H:i:s'),
                // Si la relación es HasMany/BelongsToMany, une los valores con comas
                $value instanceof Collection => $value->pluck('name')->implode(', '),
                is_array($value) => implode(', ', $value),
                default => $value ?? '',
            };
        }

        return $mappedRow;
    }

    protected function sanitizeFilters(array $filters): array
    {
        if (!property_exists($this->repository, 'filterableFields') || empty($this->repository->filterableFields)) {
            return $filters;
        }

        $allowed = $this->repository->filterableFields;

        return array_filter($filters, function ($key) use ($allowed) {
            return in_array($key, $allowed, true) || in_array(explode(':', $key)[0], $allowed, true);
        }, ARRAY_FILTER_USE_KEY);
    }
}
