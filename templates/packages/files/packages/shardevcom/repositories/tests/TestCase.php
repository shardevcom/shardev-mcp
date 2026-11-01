<?php

namespace Shardevcom\Repositories\Tests;

use Orchestra\Testbench\TestCase as Orchestra;
use Shardevcom\Repositories\RepositoryServiceProvider;

class TestCase extends Orchestra
{
    protected function setUp(): void
    {
        parent::setUp();
    }

    protected function getPackageProviders($app)
    {
        return [
            RepositoryServiceProvider::class,
        ];
    }

    protected function getEnvironmentSetUp($app)
    {
        // Configuración de la base de datos para pruebas
        $app['config']->set('database.default', 'testing');
        $app['config']->set('database.connections.testing', [
            'driver' => 'sqlite',
            'database' => ':memory:',
            'prefix' => '',
        ]);
    }

    /**
     * Configuración del entorno de testing.
     */
    protected function defineEnvironment($app): void
    {
        $app['config']->set('database.default', 'testing');

        $app['config']->set('database.connections.testing', [
            'driver' => 'sqlite',
            'database' => ':memory:',
            'prefix' => '',
            'foreign_key_constraints' => true,
        ]);
    }

    /**
     * Boot de migraciones.
     */
    protected function defineDatabaseMigrations(): void
    {
        $this->loadMigrationsFrom(
            __DIR__ . '/migrations'
        );
    }
}
