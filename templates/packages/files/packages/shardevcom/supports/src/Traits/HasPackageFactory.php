<?php

namespace Shardevcom\Supports\Traits;

use Illuminate\Database\Eloquent\Attributes\UseFactory;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @template TFactory of \Illuminate\Database\Eloquent\Factories\Factory
 */
trait HasPackageFactory
{
    /**
     * Obtener instancia factory.
     *
     * @param callable|array|int|null $count
     * @param callable|array $state
     *
     * @return TFactory
     */
    public static function factory($count = null, $state = [])
    {
        $factory = static::newFactory()
            ?? Factory::factoryForModel(static::class);

        return $factory
            ->count(
                is_numeric($count)
                    ? $count
                    : null
            )
            ->state(
                is_callable($count) || is_array($count)
                    ? $count
                    : $state
            );
    }

    /**
     * Resolver factory automáticamente.
     *
     * @return TFactory|null
     */
    protected static function newFactory()
    {
        /*
        |--------------------------------------------------------------------------
        | Factory explícita
        |--------------------------------------------------------------------------
        */

        if (isset(static::$factory)) {
            return static::$factory::new();
        }

        /*
        |--------------------------------------------------------------------------
        | PHP Attribute #[UseFactory]
        |--------------------------------------------------------------------------
        */

        if ($factory = static::getUseFactoryAttribute()) {
            return $factory;
        }

        /*
        |--------------------------------------------------------------------------
        | Resolver automáticamente package factory
        |--------------------------------------------------------------------------
        */

        $factoryClass = str_replace(
                '\\Models\\',
                '\\Factories\\',
                static::class
            ) . 'Factory';

        if (! class_exists($factoryClass)) {
            return null;
        }

        $factory = $factoryClass::new();

        $factory->guessModelNamesUsing(
            fn () => static::class
        );

        return $factory;
    }

    /**
     * Resolver #[UseFactory].
     *
     * @return TFactory|null
     */
    protected static function getUseFactoryAttribute()
    {
        $attributes = (new \ReflectionClass(static::class))
            ->getAttributes(UseFactory::class);

        if ($attributes === []) {
            return null;
        }

        $useFactory = $attributes[0]
            ->newInstance();

        $factory = $useFactory
            ->factoryClass::new();

        $factory->guessModelNamesUsing(
            fn () => static::class
        );

        return $factory;
    }
}
