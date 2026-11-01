<?php

namespace Shardevcom\Supports\Traits;

use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Builder;
use Shardevcom\Supports\Helpers\AuthHelper;
use Shardevcom\Supports\Helpers\RelationHelper;

trait HasBelongsToOwner
{
    /**
     * Cache estática de claves resueltas y polimorfismo por modelo/tabla.
     */
    protected static array $resolvedKeys = [];
    protected static array $resolvedPolymorphic = [];

    /**
     * Permite limpiar la cache en entornos de testing (Pest/PHPUnit).
     */
    public static function flushResolvedOwnerCache(): void
    {
        static::$resolvedKeys = [];
        static::$resolvedPolymorphic = [];
    }

    /**
     * Se ejecuta automáticamente al iniciar el modelo.
     */
    public static function bootHasBelongsToOwner(): void
    {
        static::addGlobalScope('ownership_filter', function (Builder $builder) {
            $instance = new static;

            $column = $instance->getOwnerKeyName();
            if (! $column) {
                return;
            }

            $user = AuthHelper::user();

            // 1. Si no hay sesión (consola/jobs/queues sin contexto), no filtramos
            if (! $user) {
                return;
            }

            // 2. Excepción para Super Admins (pueden ver todo)
            if (method_exists($user, 'hasRole') && $user->hasRole('admin')) {
                return;
            }

            // 3. Prioridad: Filtros por relación compleja
            if (method_exists($instance, 'applyCustomRelationFilter')) {
                $instance->applyCustomRelationFilter($builder, $user);

                return;
            }

            // 4. Filtro por columnas directas resolviendo el dueño
            $ownerData = $instance->resolveOwnerData($user);
            if (! $ownerData || is_null($ownerData['id'] ?? null)) {
                return;
            }

            // Calificar columnas con el nombre de la tabla para evitar ambigüedades en JOINs
            $table = $builder->getModel()->getTable();
            $qualifiedColumn = $table . '.' . $column;

            if ($instance->isPolymorphic()) {
                $qualifiedTypeColumn = $table . '.' . $instance->getOwnerTypeName();

                $builder->where($qualifiedColumn, $ownerData['id'])
                    ->where($qualifiedTypeColumn, $ownerData['type']);
            } else {
                $builder->where($qualifiedColumn, $ownerData['id']);
            }
        });

        // Asignación automática al crear el registro
        static::creating(function ($model) {
            $column = $model->getOwnerKeyName();
            if (! $column) {
                return;
            }

            // Nunca escribir sobre la propia clave primaria
            if ($column === $model->getKeyName()) {
                return;
            }

            // Un modelo cuya columna de propiedad no guarda al dueño
            // (p. ej. una clave foránea a otra entidad) la conserva tal como
            // la envía quien lo crea; el trait solo le filtra las lecturas.
            if (method_exists($model, 'assignsOwnerOnCreate') && ! $model->assignsOwnerOnCreate()) {
                return;
            }

            $user = AuthHelper::user();
            if (! $user) {
                return;
            }

            // Si es admin y el valor ya fue asignado explícitamente, respetarlo
            if (method_exists($user, 'hasRole') && $user->hasRole('admin') && ! is_null($model->{$column})) {
                return;
            }

            $ownerData = $model->resolveOwnerData($user);
            if ($ownerData && ! is_null($ownerData['id'] ?? null)) {
                $model->{$column} = $ownerData['id'];

                if ($model->isPolymorphic()) {
                    $model->{$model->getOwnerTypeName()} = $ownerData['type'];
                }
            }
        });
    }

    /**
     * Evalúa si un registro pertenece al usuario indicado (Fail-Closed por defecto).
     */
    public function isOwnedBy($user): bool
    {
        if (! $user) {
            return false;
        }

        if (method_exists($user, 'hasRole') && $user->hasRole('admin')) {
            return true;
        }

        $ownerData = $this->resolveOwnerData($user);
        if (! $ownerData || is_null($ownerData['id'] ?? null)) {
            return false;
        }

        $key = $this->getOwnerKeyName();
        if (! $key) {
            return false;
        }

        $currentOwnerId = $this->{$key};
        if (is_null($currentOwnerId)) {
            return false;
        }

        if ($this->isPolymorphic()) {
            $typeKey = $this->getOwnerTypeName();
            $currentOwnerType = $this->{$typeKey};

            return (string) $currentOwnerId === (string) $ownerData['id'] &&
                (string) $currentOwnerType === (string) $ownerData['type'];
        }

        return (string) $currentOwnerId === (string) $ownerData['id'];
    }

    /**
     * Resuelve quién es el dueño según el modelo y el usuario logueado.
     */
    public function resolveOwnerData($user): ?array
    {
        if (method_exists($this, 'getCustomOwner')) {
            return $this->getCustomOwner($user);
        }

        if (isset($user->owner_id, $user->owner_type) && $user->owner_id && $user->owner_type) {
            return [
                'id' => $user->owner_id,
                'type' => $user->owner_type,
            ];
        }

        if (! isset($user->id)) {
            return null;
        }

        return [
            'id' => $user->id,
            'type' => RelationHelper::morphType($user),
        ];
    }

    /**
     * Resuelve el nombre de la columna de la clave del propietario.
     */
    public function getOwnerKeyName(): ?string
    {
        $table = $this->getTable();

        if (array_key_exists($table, static::$resolvedKeys)) {
            return static::$resolvedKeys[$table];
        }

        $resolvedKey = null;

        if ($this instanceof Authenticatable) {
            $resolvedKey = 'id';
        } elseif (property_exists($this, 'ownerKey') && ! empty($this->ownerKey)) {
            $resolvedKey = $this->ownerKey;
        } else {
            $possibleKeys = AuthHelper::ownerColumns();
            foreach ($possibleKeys as $key) {
                if (str_ends_with($key, '_type')) {
                    continue;
                }

                if ($this->getConnection()->getSchemaBuilder()->hasColumn($table, $key)) {
                    $resolvedKey = $key;
                    break;
                }
            }
        }

        return static::$resolvedKeys[$table] = $resolvedKey;
    }

    /**
     * Obtiene el nombre de la columna de Tipo (solo polimórficos).
     */
    public function getOwnerTypeName(): string
    {
        return property_exists($this, 'ownerTypeKey') && ! empty($this->ownerTypeKey)
            ? $this->ownerTypeKey
            : 'owner_type';
    }

    /**
     * Determina si el modelo usa relaciones polimórficas para el dueño.
     */
    public function isPolymorphic(): bool
    {
        $table = $this->getTable();

        if (array_key_exists($table, static::$resolvedPolymorphic)) {
            return static::$resolvedPolymorphic[$table];
        }

        // 1. Declaración explícita en la clase del modelo
        if (property_exists($this, 'ownerTypeKey') && ! empty($this->ownerTypeKey)) {
            return static::$resolvedPolymorphic[$table] = true;
        }

        // 2. Comprobación real en el esquema de la base de datos (con cache para no saturar queries)
        $typeColumn = $this->getOwnerTypeName();
        $isPoly = $this->getConnection()->getSchemaBuilder()->hasColumn($table, $typeColumn);

        return static::$resolvedPolymorphic[$table] = $isPoly;
    }
}
