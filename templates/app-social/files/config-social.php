<?php

/*
| Login social de la app `{{ app.key }}`: login por un id_token verificado del proveedor.
| Los identificadores de cliente (audience) NO se declaran aquí: los leen los verificadores de
| `integrations` de config/services.php (GOOGLE_*, MICROSOFT_*, APPLE_*), sin valores por defecto.
*/
return [
    // Proveedores habilitados en ESTA app. Cualquier otro se rechaza (404), configurado o no.
    'providers' => [{{ app.social_providers_php }}],

    // Crear la cuenta si el correo verificado del proveedor no tiene cuenta (viene del spec: auto_register).
    'auto_register' => {{ app.auto_register }},
];
