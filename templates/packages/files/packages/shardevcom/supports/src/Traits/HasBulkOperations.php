<?php

namespace Shardevcom\Supports\Traits;

use Illuminate\Http\Request;
use Shardevcom\Supports\Responses\JsonResponse;

trait HasBulkOperations
{
    /**
     * Eliminar múltiples registros.
     */
    public function bulkDestroy(Request $request)
    {
        return JsonResponse::execute($this->repository, 'deleteMany', function () use ($request) {
            $ids = $request->input('ids', []);
            $ids = $this->beforeBulkDestroy($ids, $request);

            $deletedCount = $this->bulkDestroyAction($ids);

            return $this->afterBulkDestroy(['deleted' => $deletedCount], $request);
        });
    }

    /**
     * Actualizar múltiples registros.
     */
    public function bulkUpdate(Request $request)
    {
        return JsonResponse::execute($this->repository, 'updateMany', function () use ($request) {
            $data = $request->input('data', []);
            $data = $this->beforeBulkUpdate($data, $request);

            $updatedCount = $this->bulkUpdateAction($data);

            return $this->afterBulkUpdate(['updated' => $updatedCount], $request);
        });
    }

    // --- ACCIONES INTERNAS (Sobrescribibles) ---

    protected function bulkDestroyAction(array $ids): mixed
    {
        return $this->repository->deleteMany($ids);
    }

    protected function bulkUpdateAction(array $data): mixed
    {
        return $this->repository->updateMany($data);
    }
    protected function beforeBulkDestroy(array $ids, Request $request): array
    {
        return $ids;
    }

    protected function afterBulkDestroy(array $result, Request $request): array
    {
        return $result;
    }

    protected function beforeBulkUpdate(array $data, Request $request): array
    {
        return $data;
    }

    protected function afterBulkUpdate(array $result, Request $request): array
    {
        return $result;
    }
}
