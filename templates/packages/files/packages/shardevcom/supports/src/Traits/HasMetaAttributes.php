<?php

namespace Shardevcom\Supports\Traits;

use Illuminate\Support\Arr;
use Illuminate\Support\Str;

trait HasMetaAttributes
{
    /**
     * Devuelve el valor de una clave dentro del campo meta.
     */
    public function getMeta(string $key, $default = null)
    {
        return Arr::get($this->meta ?? [], $key, $default);
    }

    /**
     * Establece el valor de una clave dentro de meta.
     */
    public function setMeta(string $key, $value)
    {
        $meta = $this->meta ?? [];
        Arr::set($meta, $key, $value);
        $this->meta = $meta;

        return $this;
    }

    /**
     * Permite acceder a claves del meta como si fueran propiedades del modelo.
     */
    public function __get($key)
    {
        // Si es atributo nativo
        if (array_key_exists($key, $this->attributes)) {
            return parent::__get($key);
        }

        // Si existe dentro de meta
        if (is_array($this->meta) && array_key_exists($key, $this->meta)) {
            return $this->meta[$key];
        }

        // Si existe una clave meta tipo {key}_id, resolvemos relación automática
        $metaKey = "{$key}_id";
        if (isset($this->meta[$metaKey])) {
            $modelClass = $this->guessModelClass($key);
            if (class_exists($modelClass)) {
                return $modelClass::find($this->meta[$metaKey]);
            }
        }

        return parent::__get($key);
    }

    /**
     * Permite asignar valores a meta dinámicamente.
     */
    public function __set($key, $value)
    {
        if ($this->hasCast('meta', 'array') && !array_key_exists($key, $this->attributes)) {
            $this->setMeta($key, $value);
        } else {
            parent::__set($key, $value);
        }
    }

    /**
     * Adivina el nombre de la clase modelo basado en el nombre del campo.
     * Ejemplo: product -> App\Models\Product
     */
    protected function guessModelClass(string $key): string
    {
        return 'App\\Models\\' . Str::studly(Str::singular($key));
    }
}
