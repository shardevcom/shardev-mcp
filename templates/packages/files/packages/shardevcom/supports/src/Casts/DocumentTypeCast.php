<?php

namespace Shardevcom\Supports\Casts;

use Illuminate\Contracts\Database\Eloquent\CastsAttributes;

class DocumentTypeCast implements CastsAttributes
{
    /**
     * Lista de tipos de documento.
     */
    protected const DOCUMENT_TYPES = [
        '10' => 'Certificado de nacido vivo',
        '11' => 'Registro civil',
        '12' => 'Tarjeta de identidad',
        '13' => 'Cédula de ciudadanía',
        '21' => 'Tarjeta de extranjería',
        '22' => 'Cédula de extranjería',
        '31' => 'NIT',
        '41' => 'Pasaporte',
        '42' => 'Documento de identificación extranjero',
        '47' => 'PEP (Permiso Especial de Permanencia)',
        '48' => 'PPT (Permiso Protección Temporal)',
        '50' => 'NIT de otro país',
        '91' => 'NUIP',
    ];

    /**
     * Transform the value when retrieving it from the database.
     */
    public function get($model, string $key, $value, array $attributes)
    {
        if (! $value) {
            return null;
        }

        // Separar por ";" y limpiar espacios
        $parts = array_filter(array_map('trim', explode(';', $value)));

        foreach ($parts as $part) {
            // Extraer código numérico (eliminar prefijo O- si existe)
            $code = preg_replace('/^O-/', '', $part);

            // Retornar la primera coincidencia válida
            if (isset(self::DOCUMENT_TYPES[$code])) {
                return self::DOCUMENT_TYPES[$code];
            }
        }

        // Si ninguno coincide, devolver el valor limpio del primer elemento
        $first = reset($parts);
        return preg_replace('/^O-/', '', $first);
    }

    /**
     * Transform the value when storing it to the database.
     */
    public function set($model, string $key, $value, array $attributes)
    {
        // Guardar el valor original sin modificar
        return $value;
    }
}
