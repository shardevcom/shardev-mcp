<?php

namespace Shardevcom\Supports\Traits;

use Illuminate\Database\Eloquent\Relations\MorphTo;
use Illuminate\Support\Facades\Schema;
use Shardevcom\Supports\Helpers\AuthHelper;

trait HasUserActions
{
    /**
     * Cachea las columnas de la tabla para no consultar el Schema en cada evento.
     */
    protected static array $hasUserActionsColumnsCache = [];

    public static function bootHasUserActions(): void
    {
        static::creating(function ($model) {
            $user = AuthHelper::user();

            if ($user) {
                $morphType = AuthHelper::type($user);

                if ($model->hasUserActionColumn('created_by_id') && empty($model->created_by_id)) {
                    $model->created_by_id = $user->getKey();
                    if ($model->hasUserActionColumn('created_by_type')) {
                        $model->created_by_type = $morphType;
                    }
                }

                if ($model->hasUserActionColumn('updated_by_id') && empty($model->updated_by_id)) {
                    $model->updated_by_id = $user->getKey();
                    if ($model->hasUserActionColumn('updated_by_type')) {
                        $model->updated_by_type = $morphType;
                    }
                }
            }
        });

        static::updating(function ($model) {
            $user = AuthHelper::user();

            if ($user && $model->hasUserActionColumn('updated_by_id')) {
                $model->updated_by_id = $user->getKey();
                if ($model->hasUserActionColumn('updated_by_type')) {
                    $model->updated_by_type = AuthHelper::type($user);
                }
            }
        });

        if (method_exists(static::class, 'deleting')) {
            static::deleting(function ($model) {
                $user = AuthHelper::user();

                if ($user && method_exists($model, 'isForceDeleting') && !$model->isForceDeleting()) {
                    if ($model->hasUserActionColumn('deleted_by_id')) {
                        $model->deleted_by_id = $user->getKey();
                        if ($model->hasUserActionColumn('deleted_by_type')) {
                            $model->deleted_by_type = AuthHelper::type($user);
                        }
                        $model->saveQuietly();
                    }
                }
            });
        }
    }

    /**
     * Verifica si la tabla del modelo posee una columna específica de forma segura.
     */
    public function hasUserActionColumn(string $column): bool
    {
        $table = $this->getTable();

        if (!isset(static::$hasUserActionsColumnsCache[$table])) {
            static::$hasUserActionsColumnsCache[$table] = Schema::getColumnListing($table);
        }

        return in_array($column, static::$hasUserActionsColumnsCache[$table], true);
    }

    /**
     * Columnas públicas no comprometedoras del usuario.
     */
    protected function safeUserColumns(): array
    {
        return ['id', 'name'];
    }

    /**
     * Relación polimórfica con el creador del registro.
     */
    public function creator(): MorphTo
    {
        return $this->morphTo(__FUNCTION__, 'created_by_type', 'created_by_id')
            ->withoutGlobalScopes()
            ->select($this->safeUserColumns());
    }

    /**
     * Relación polimórfica con el último usuario que actualizó el registro.
     */
    public function updater(): MorphTo
    {
        return $this->morphTo(__FUNCTION__, 'updated_by_type', 'updated_by_id')
            ->withoutGlobalScopes()
            ->select($this->safeUserColumns());
    }

    /**
     * Relación polimórfica con el usuario que eliminó el registro.
     */
    public function deleter(): MorphTo
    {
        return $this->morphTo(__FUNCTION__, 'deleted_by_type', 'deleted_by_id')
            ->withoutGlobalScopes()
            ->select($this->safeUserColumns());
    }
}
