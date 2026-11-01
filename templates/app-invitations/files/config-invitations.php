<?php

/*
| Invitaciones de la app `{{ app.key }}`. Las invitaciones no asignan roles en v1: la cuenta nace sin roles y el
| dueño le asigna el rol después. Así invitar no permite escalar privilegios.
*/
return [
    // Días de vida de una invitación (configurable).
    'ttl_days' => 7,

    // Invitaciones por hora y cuenta que invita (429 pasado el tope) y por correo y hora (en silencio).
    'max_per_inviter_per_hour' => 30,
    'max_per_email_per_hour' => 3,
];
