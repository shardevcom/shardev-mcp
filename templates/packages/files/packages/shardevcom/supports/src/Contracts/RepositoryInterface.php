<?php

namespace Shardevcom\Supports\Contracts;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;

interface RepositoryInterface
{
    /**
     * Crear un nuevo registro
     *
     * @param array $data
     * @return Model
     */
    public function insert(array $data): Model;

    /**
     * Actualizar un registro existente
     *
     * @param string|int $id
     * @param array $data
     * @return Model
     */
    public function update(string|int $id, array $data): Model;

    /**
     * Eliminar un registro por ID
     *
     * @param string|int $id
     * @return bool
     */
    public function remove(string|int $id): bool;

    /**
     * Obtener una colección de registros con filtros opcionales
     *
     * @param array $query
     * @return Collection|null
     */
    public function fetch(array $query = []): ?Collection;

    /**
     * Obtener múltiples registros con paginación
     *
     * @param array $params
     * @return LengthAwarePaginator|Collection
     */
    public function fetchMany(array $params = []): LengthAwarePaginator|Collection;

    /**
     * Encontrar un registro por ID
     *
     * @param string|int $id
     * @param array $query
     * @return Model|null
     */
    public function find(string|int $id, array $query = []): ?Model;
}
