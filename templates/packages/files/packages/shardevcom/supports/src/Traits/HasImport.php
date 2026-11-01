<?php

namespace Shardevcom\Supports\Traits;

    use Illuminate\Http\Request;
    use Illuminate\Support\Facades\Validator;
    use Maatwebsite\Excel\Facades\Excel;
    use Shardevcom\Supports\Requests\ImportRequest;
    use Shardevcom\Supports\Responses\JsonResponse;

trait HasImport
{
    /**
     * Importar registros desde un archivo (ej. XLSX/CSV).
     */
    public function import(Request $request)
    {
        // 1. AUTORIZACIÓN: Corta la petición si el usuario no tiene permisos
        if (method_exists($this->repository, 'authorizeImport')) {
            $this->repository->authorizeImport();
        }

        // 2. Verificar configuración de la clase importadora
        if (empty($this->importClass) || ! class_exists($this->importClass)) {
            abort(404, 'Import class configuration invalid or not found.');
        }

        // 3. Validación del archivo
        $validator = Validator::make(
            ['file' => $request->file('file')],
            (new ImportRequest)->rules()
        );

        if ($validator->fails()) {
            abort(422, $validator->errors()->first('file'));
        }

        // 4. Ejecución del proceso
        return JsonResponse::execute($this->repository, 'import', function () use ($request) {
            $import = app()->make(
                $this->importClass,
                [
                    $this->repository::class => $this->repository,
                ]
            );

            Excel::import($import, $request->file('file'));

            return $import->getResults();
        });
    }

}
