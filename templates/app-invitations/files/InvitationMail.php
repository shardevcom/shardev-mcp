<?php

namespace App\Auth\Invitations;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * Correo de invitación a la app `{{ app.key }}`. NO implementa ShouldQueue a propósito: una cola (base de datos,
 * Redis) guardaría el enlace con el token en claro dentro del payload del trabajo. El token va en el
 * FRAGMENTO de la URL (#token=...): el navegador no lo envía al servidor ni lo deja en logs o `Referer`.
 */
class {{ app.model }}InvitationMail extends Mailable
{
    public function __construct(public readonly string $url, public readonly int $days) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: __('You have been invited'));
    }

    public function content(): Content
    {
        return new Content(view: 'mail.{{ app.key }}-invitation');
    }
}
