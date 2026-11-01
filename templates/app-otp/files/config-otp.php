<?php

/*
| Login por código (OTP) de la app `{{ app.key }}`. Los códigos los emite el paquete `verification`
| (hash, caducidad, intentos máximos y enfriamiento: config/verification.php); aquí solo lo propio de la app.
*/
return [
    // Propósito del desafío. Lleva la app: un código pedido para otra app no sirve en esta.
    'purpose' => 'login:{{ app.key }}',

    // Crear la cuenta en el primer código válido (viene del spec: auto_register). Con false, un correo
    // sin cuenta nunca recibe código ni entra.
    'auto_register' => {{ app.auto_register }},

    // Códigos que se envían por correo y hora. Pasado el tope no se envía nada y la respuesta es la misma.
    'max_requests_per_hour' => 5,

    // Verificaciones por correo en la ventana (aparte del tope de intentos de cada código).
    'verify_attempts' => 10,
    'verify_window_minutes' => 15,
];
