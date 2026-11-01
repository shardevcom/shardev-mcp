<?php

namespace Shardevcom\Authentications\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Laravel\Passport\ClientRepository;
use Shardevcom\Authentications\Support\AppRegistry;

/**
 * Prepara Passport para las apps del proyecto: llaves OAuth y UN cliente de acceso personal por
 * provider. Sin el cliente de su provider, createToken() falla; con un cliente compartido, un
 * token de una app podría ser aceptado por otra. Es idempotente: ejecútalo en cada despliegue
 * después de migrar (`php artisan authentications:setup`).
 */
class SetupAuth extends Command
{
    protected $signature = 'authentications:setup {--force-keys : Regenera las llaves OAuth aunque existan (invalida todos los tokens)}';

    protected $description = 'Crea las llaves de Passport y un cliente de acceso personal por provider de las apps.';

    public function handle(ClientRepository $clients): int
    {
        if ($this->option('force-keys') || ! $this->keysExist()) {
            Artisan::call('passport:keys', ['--force' => (bool) $this->option('force-keys')]);
            $this->info('Llaves OAuth creadas.');
        }

        $providers = AppRegistry::providers();
        if ($providers === []) {
            $this->warn('No hay apps en config/authentications.php: nada que preparar.');

            return self::SUCCESS;
        }

        foreach ($providers as $provider) {
            $name = ucfirst($provider) . ' Personal Access Client';

            if (DB::table('oauth_clients')->where('provider', $provider)->where('name', $name)->exists()) {
                $this->line("Cliente personal ya existe para [{$provider}].");

                continue;
            }

            $clients->createPersonalAccessGrantClient($name, $provider);
            $this->info("Cliente personal creado para [{$provider}].");
        }

        return self::SUCCESS;
    }

    private function keysExist(): bool
    {
        if (config('passport.private_key') && config('passport.public_key')) {
            return true; // llaves por variable de entorno (PASSPORT_PRIVATE_KEY / PASSPORT_PUBLIC_KEY)
        }

        return is_file(storage_path('oauth-private.key')) && is_file(storage_path('oauth-public.key'));
    }
}
