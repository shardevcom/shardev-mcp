<?php

namespace Shardevcom\Authentications\Exports;

use Shardevcom\Supports\Exports\BaseExport;

class PermissionExport extends BaseExport
{
    protected array $customHeadings = [
        'ID',
        'Nombre',
        'Descripción',
        'Grupo',
        'Guard',
        'Fecha de creación',
        'Última actualización',
    ];
}
