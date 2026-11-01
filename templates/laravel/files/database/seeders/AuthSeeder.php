<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Artisan;
use Shardevcom\Supports\Models\Role;
use Shardevcom\Supports\Services\PermissionSyncService;
use Spatie\Permission\PermissionRegistrar;

/**
 * Prepara la autenticación: clientes Passport por provider (idempotente), roles de
 * config('shardevcom.roles') y la matriz de config('shardevcom.permissions'). Se puede ejecutar
 * las veces que haga falta. En producción corre `php artisan authentications:setup` en cada
 * despliegue, aunque no siembres datos.
 */
class AuthSeeder extends Seeder
{
    public function run(): void
    {
        Artisan::call('authentications:setup');
        app(PermissionRegistrar::class)->forgetCachedPermissions();

        foreach (config('shardevcom.roles', []) as $guard => $roles) {
            foreach ($roles as $name) {
                Role::firstOrCreate(['name' => $name, 'guard_name' => $guard]);
            }
        }

        app(PermissionSyncService::class)->sync();
    }
}
