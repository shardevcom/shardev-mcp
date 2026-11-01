<?php

namespace Shardevcom\Authentications\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Validator;
use Shardevcom\Authentications\Support\AppRegistry;

/**
 * Crea la primera cuenta de una app (p. ej. el administrador inicial). La contraseña se pide en
 * modo oculto; nunca se acepta como argumento (quedaría en el historial del shell).
 */
class CreateAccount extends Command
{
    protected $signature = 'authentications:create-account {app : key de la app (config/authentications.php)} {email} {--name= : Nombre} {--role= : Rol a asignar (debe existir en el guard de la app)}';

    protected $description = 'Crea una cuenta en una app del proyecto.';

    public function handle(): int
    {
        $key = (string) $this->argument('app');
        $apps = AppRegistry::all();

        if (! isset($apps[$key])) {
            $this->error("App desconocida [{$key}]. Apps: " . implode(', ', array_keys($apps)));

            return self::FAILURE;
        }

        $model = $apps[$key]['model'];
        $email = (string) $this->argument('email');
        $password = (string) $this->secret('Contraseña (mínimo 10 caracteres)');

        $v = Validator::make(
            ['email' => $email, 'password' => $password],
            ['email' => ['required', 'email'], 'password' => ['required', 'string', 'min:10']],
        );
        if ($v->fails()) {
            $this->error($v->errors()->first());

            return self::FAILURE;
        }

        if ($model::query()->where('email', $email)->exists()) {
            $this->error('Ya existe una cuenta con ese email.');

            return self::FAILURE;
        }

        $account = $model::query()->create([
            'name' => $this->option('name') ?: strstr($email, '@', true),
            'email' => $email,
            'password' => $password,
            'active' => true,
        ]);

        if ($role = $this->option('role')) {
            $account->assignRole($role);
        }

        $this->info("Cuenta creada en [{$key}]: {$email}" . ($role ? " (rol {$role})" : ''));

        return self::SUCCESS;
    }
}
