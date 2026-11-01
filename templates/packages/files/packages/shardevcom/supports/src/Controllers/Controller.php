<?php

namespace Shardevcom\Supports\Controllers;

use Illuminate\Http\Request;
use Shardevcom\Supports\Requests\JsonRequest;
use Shardevcom\Supports\Responses\JsonResponse;

abstract class Controller
{
    protected $repository;
    protected ?string $requestClass = null;

    /**
     * Helper centralizado y flexible para ejecutar cualquier acción
     * garantizando el envoltorio de JsonResponse::execute().
     *
     * @param string $action Nombre de la acción para auditoría/logs (ej. 'insert', 'customAction')
     * @param callable $callback Lógica de negocio a ejecutar dentro del contexto del repositorio
     * @param int $code Código HTTP de respuesta exitosa (por defecto 200)
     * @return mixed
     */
    protected function respond(string $action, callable $callback, int $code = 200)
    {
        return JsonResponse::execute(
            $this->repository,
            $action,
            $callback,
            $code
        );
    }

    // =========================================================================
    // MÉTODOS CRUD ESTÁNDAR
    // =========================================================================

    public function index(Request $request)
    {
        return $this->respond('fetchMany', fn () => $this->fetchManyAction($request));
    }

    public function show(Request $request, string $id)
    {
        return $this->respond('find', fn () => $this->findAction($id, $request));
    }

    public function store(Request $request)
    {
        return $this->respond('insert', function () use ($request) {
            $data   = $this->resolveValidatedData($request);
            $data   = $this->beforeStore($data, $request);
            $result = $this->storeAction($data, $request);
            return $this->afterStore($result, $request);
        }, $this->getStoreSuccessCode());
    }

    public function update(Request $request, string $id)
    {
        return $this->respond('update', function () use ($id, $request) {
            $data   = $this->resolveValidatedData($request);
            $data   = $this->beforeUpdate($data, $request);
            $result = $this->updateAction($id, $data, $request);

            return $this->afterUpdate($result, $request);
        });
    }

    public function destroy(string $id, Request $request)
    {
        return $this->respond('remove', fn () => $this->destroyAction($id, $request));
    }

    /**
     * Permite a los controladores hijos cambiar el código de respuesta
     * de creación (por ejemplo, a 202 Accepted si es asíncrono).
     */
    protected function getStoreSuccessCode(): int
    {
        return 201;
    }

    // =========================================================================
    // ACCIONES INTERNAS (Sobrescribibles)
    // =========================================================================

    protected function fetchManyAction(Request $request)
    {
        return $this->repository->fetchMany($request->all());
    }

    protected function findAction(string $id, Request $request)
    {
        return $this->repository->find($id, $request->all());
    }

    protected function storeAction(array $data, Request $request)
    {
        return $this->repository->insert($data);
    }

    protected function updateAction(string $id, array $data, Request $request)
    {
        return $this->repository->update($id, $data);
    }

    protected function destroyAction(string $id, Request $request)
    {
        return $this->repository->remove($id);
    }

    // =========================================================================
    // HOOKS / GANCHOS
    // =========================================================================

    protected function beforeStore(array $data, Request $request): array { return $data; }
    protected function afterStore(mixed $result, Request $request): mixed { return $result; }
    protected function beforeUpdate(array $data, Request $request): array { return $data; }
    protected function afterUpdate(mixed $result, Request $request): mixed { return $result; }

    // =========================================================================
    // RESOLUCIÓN Y VALIDACIÓN DE REQUEST
    // =========================================================================

    /**
     * Resuelve los datos validados usando la clase $requestClass (si existe)
     * o permite especificar una clase de FormRequest personalizada al vuelo.
     */
    protected function resolveValidatedData(Request $request, ?string $customRequestClass = null): array
    {
        $classToResolve = $customRequestClass ?? $this->requestClass;

        if (! $classToResolve) {
            return $request->all();
        }

        /** @var JsonRequest $formRequest */
        $formRequest = app()->make($classToResolve);
        $formRequest->replace($request->all());
        $formRequest->setMethod($request->method());

        if (method_exists($formRequest, 'validateResolved')) {
            $formRequest->validateResolved();
        }

        return $formRequest->validated();
    }
}
