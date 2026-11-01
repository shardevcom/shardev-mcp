<?php

namespace Tests\Feature\Concerns;

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Route;
use Shardevcom\Authentications\Models\Account;
use Spatie\Permission\PermissionRegistrar;

/** Prepara Passport (un cliente personal por provider) y los roles/permisos, y crea cuentas por app. */
trait AuthApps
{
    /** Contraseña de las cuentas de prueba (la fija la fábrica de cada app). */
    private const WRONG_PASSWORD = 'not-the-password'; // shardev-allow-secret: dato de prueba
    private const TEST_PASSWORD = 'password-for-tests'; // shardev-allow-secret: dato de prueba

    protected function setUpAuthApps(): void
    {
        Artisan::call('authentications:setup');
        app(PermissionRegistrar::class)->forgetCachedPermissions();
        Artisan::call('db:seed', ['--class' => \Database\Seeders\AuthSeeder::class, '--no-interaction' => true]);
    }

    /** @return array<string, array{guard:string,session_guard:string,provider:string,model:class-string<Account>}> */
    protected function apps(): array
    {
        return array_filter(
            (array) config('authentications.apps'),
            fn (array $a) => method_exists($a['model'], 'factory'),
        );
    }

    /**
     * Apps con login por contraseña. Una app con la feature `otp` entra por código y no registra signin ni
     * change-password: sus pruebas de entrada están en el test de su propio login por código.
     *
     * @return array<string, array{guard:string,session_guard:string,provider:string,model:class-string<Account>}>
     */
    protected function passwordApps(): array
    {
        return array_filter($this->apps(), fn (array $a, string $key) => Route::has("{$key}.signin"), ARRAY_FILTER_USE_BOTH);
    }

    protected function makeAccount(string $app, array $attributes = [], ?string $role = null): Account
    {
        $account = config("authentications.apps.{$app}.model")::factory()->create($attributes);

        if ($role !== null) {
            $account->assignRole($role);
        }

        return $account;
    }

    /** Header Bearer con un token real emitido por el cliente personal del provider de la cuenta. */
    protected function bearer(Account $account): array
    {
        // Los guards cachean el usuario resuelto dentro del mismo proceso de test.
        $this->app['auth']->forgetGuards();

        return ['Authorization' => 'Bearer ' . $account->createToken('test')->accessToken];
    }

    protected function as(array $headers): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withHeaders($headers);
    }
}
