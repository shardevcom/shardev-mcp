<?php

namespace App\Auth\Otp;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * Correo con el código de la app `{{ app.key }}`. NO implementa ShouldQueue a propósito: una cola
 * (base de datos, Redis) guardaría el código en claro dentro del payload del trabajo.
 */
class {{ app.model }}LoginCodeMail extends Mailable
{
    public function __construct(public readonly string $code, public readonly int $minutes) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: __('Your sign-in code'));
    }

    public function content(): Content
    {
        return new Content(view: 'mail.{{ app.key }}-login-code');
    }
}
