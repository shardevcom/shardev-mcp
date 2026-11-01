<?php

namespace Shardevcom\Supports\Traits;

class HasResourceResponse
{

    /**
     * Obtiene el nombre del recurso desde el repositorio.
     */
    protected function getResourceName(): string
    {
        return $this->repository->getResource();
    }


}
