<?php

namespace App\Console\Commands;

use {{ app.invitation_service_class }};
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Validator;
use Shardevcom\Supports\Exceptions\UserFacingException;

/**
 * Primera invitación de la app `{{ app.key }}` (arranque: todavía no hay quien invite). Sin invitador.
 * En producción pide confirmación (o --force). No imprime el token ni el enlace.
 */
class {{ app.model }}InviteCommand extends Command
{
    protected $signature = '{{ app.key }}:invite {email : Correo de la persona invitada} {--force : Omite la confirmación en producción}';

    protected $description = 'Envía la primera invitación de la app {{ app.key }}.';

    public function handle({{ app.model }}InvitationService $invitations): int
    {
        $email = (string) $this->argument('email');
        if (Validator::make(['email' => $email], ['email' => ['required', 'email', 'max:255']])->fails()) {
            $this->error('Correo inválido.');

            return self::FAILURE;
        }

        if (app()->isProduction() && ! $this->option('force') && ! $this->confirm("Estás en PRODUCCIÓN. ¿Enviar la invitación de la app {{ app.key }} a {$email}?", false)) {
            $this->warn('Cancelado.');

            return self::FAILURE;
        }

        try {
            $invitations->assertCanSend();
        } catch (UserFacingException $e) {
            $this->error($e->getMessage() . ' (MAIL_MAILER no entrega correo real en este entorno).');

            return self::FAILURE;
        }

        // El operador es de confianza: aquí sí se dice si la cuenta ya existe (la API no lo revela).
        if ($invitations->accountExists($email)) {
            $this->warn('Ya existe una cuenta con ese correo; no se envió nada.');

            return self::SUCCESS;
        }

        if (! $invitations->invite(null, $email)) {
            $this->error('No se pudo enviar la invitación (los logs registran solo el tipo de error).');

            return self::FAILURE;
        }
        $this->info("Invitación enviada a {$email}.");

        return self::SUCCESS;
    }
}
