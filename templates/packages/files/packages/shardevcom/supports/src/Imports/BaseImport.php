<?php

namespace Shardevcom\Supports\Imports;

use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Database\QueryException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Maatwebsite\Excel\Concerns\RemembersRowNumber;
use Maatwebsite\Excel\Concerns\ToCollection;
use Maatwebsite\Excel\Concerns\WithBatchInserts;
use Maatwebsite\Excel\Concerns\WithChunkReading;
use Maatwebsite\Excel\Concerns\WithHeadingRow;
use Shardevcom\Supports\Exceptions\UserFacingException;
use Shardevcom\Supports\Helpers\NameHelper;

abstract class BaseImport implements ToCollection, WithHeadingRow, WithChunkReading, WithBatchInserts, ShouldQueue
{
    use RemembersRowNumber;

    /** Niveles de incidencia por fila (ver import_log_rows.level). */
    public const LEVEL_SKIPPED = 'skipped';

    public const LEVEL_WARNING = 'warning';

    public const LEVEL_ERROR = 'error';

    /** Límites del snapshot de la fila original que acompaña a cada incidencia. */
    protected const ROW_DATA_MAX_COLUMNS = 30;

    protected const ROW_DATA_MAX_KEY_LENGTH = 100;

    protected const ROW_DATA_MAX_VALUE_LENGTH = 255;

    protected const ISSUE_MESSAGE_MAX_LENGTH = 1000;

    protected const ROW_KEY_MAX_LENGTH = 255;

    /** Clases (exactas) cuyo getMessage() se muestra al usuario. */
    private const PUBLIC_MESSAGE_EXCEPTIONS = [
        \RuntimeException::class,
        \InvalidArgumentException::class,
        \DomainException::class,
    ];

    /** Filas recorridas por esta instancia (respaldo de getRowNumber()). */
    protected int $processedRowCounter = 0;

    protected mixed $repository;
    protected array $errors = [];
    protected array $warnings = [];
    protected array $counts = [];
    protected int $totalProcessed = 0;

    protected ?string $rowKey = null;
    protected ?string $normalizeKey = null;

    protected ?int    $ownerContextId   = null;
    protected ?string $ownerContextType = null;

    /**
     * La importación la inició un admin de plataforma (ImportLog
     * created_by_platform_admin). Por defecto false: falla cerrado para
     * acciones reservadas a la plataforma.
     */
    protected bool $createdByPlatformAdmin = false;

    // -------------------------------------------------------------------------
    // Estado de la fila en curso y registro estructurado de incidencias.
    //
    // errors/warnings (arriba) siguen siendo listas deduplicadas por mensaje
    // (compatibilidad con import_logs.errors/warnings). Además, cada incidencia
    // se registra aquí, sin deduplicar, con su número de fila, para que el Job
    // la persista en import_log_rows (ver pullRowIssues()).
    // -------------------------------------------------------------------------

    /** Número de fila (Excel) que se está procesando; null = fuera de una fila. */
    protected ?int $currentRowNumber = null;

    /** Snapshot saneado de la fila original en curso. */
    protected ?array $currentRowData = null;

    /** Identificador de la fila en curso, si se conoce. */
    protected ?string $currentRowKey = null;

    /** Niveles registrados para la fila en curso (level => true). */
    protected array $currentRowLevels = [];

    /** Índice en $rowIssues de la primera incidencia de la fila en curso. */
    protected int $currentRowIssueStart = 0;

    /** Si la fila en curso terminó processNormalizedRow() sin excepción. */
    protected bool $currentRowProcessed = false;

    /** Buffer de incidencias pendientes de persistir. */
    protected array $rowIssues = [];

    /** Incidencias descartadas porque el buffer alcanzó el tope. */
    protected int $droppedRowIssues = 0;

    protected int $successfulRows = 0;
    protected int $skippedRows = 0;
    protected int $warningRows = 0;
    protected int $errorRows = 0;

    public function __construct(mixed $repository)
    {
        $this->repository = $repository;
    }

    /**
     * Define el tamaño de bloque de lectura desde la configuración centralizada.
     */
    public function chunkSize(): int
    {
        return (int) config('imports.chunk_size', 50);
    }

    /**
     * Define cuántas filas persistir por bloque.
     */
    public function batchSize(): int
    {
        return (int) config('imports.chunk_size', 50);
    }

    public function setOwnerContext(int $ownerId, string $ownerType): static
    {
        $this->ownerContextId   = $ownerId;
        $this->ownerContextType = $ownerType;
        return $this;
    }

    public function setCreatedByPlatformAdmin(bool $value): static
    {
        $this->createdByPlatformAdmin = $value;

        return $this;
    }

    protected function customTransformations(): array
    {
        return [];
    }

    protected function getAllowedFields(): array
    {
        if (property_exists($this->repository, 'allowedFields') && !empty($this->repository->allowedFields)) {
            return $this->repository->allowedFields;
        }

        return [];
    }

    public function collection(Collection $collection)
    {
        if ($collection->isEmpty()) {
            $this->addWarning('No se encontraron filas válidas en el archivo.');
            return;
        }

        foreach ($collection as $row) {
            $this->processedRowCounter++;

            // Número de fila real en Excel. RemembersRowNumber solo lo informa en
            // importaciones fila a fila; con ToCollection llega null, así que se
            // calcula con un contador propio (fila 1 = encabezados).
            $currentRowNumber = $this->getRowNumber() ?? $this->processedRowCounter + 1;

            $rowArray = is_array($row) ? $row : $row->toArray();

            $this->beginRow($currentRowNumber, $rowArray);

            try {
                $normalizedRow = $this->normalizeRow($rowArray, $currentRowNumber);

                if ($normalizedRow === null) {
                    // Una fila descartada sin motivo registrado se marca como
                    // omitida igualmente: nunca cuenta como exitosa.
                    if (! $this->currentRowHas(self::LEVEL_SKIPPED) && ! $this->currentRowHas(self::LEVEL_ERROR)) {
                        $this->recordRowIssue(self::LEVEL_SKIPPED, "Fila {$currentRowNumber} omitida.");
                    }

                    continue;
                }

                $this->currentRowKey ??= $this->resolveRowKey($normalizedRow);

                try {
                    $this->processNormalizedRow($normalizedRow, $currentRowNumber);
                    $this->totalProcessed++;
                    $this->currentRowProcessed = true;
                } catch (\Throwable $e) {
                    $this->handleProcessingError($normalizedRow, $e, $currentRowNumber);

                    // Un handleProcessingError() sobrescrito podría no registrar
                    // nada: la fila igualmente queda como error.
                    if (! $this->currentRowHas(self::LEVEL_ERROR)) {
                        $this->recordRowIssue(self::LEVEL_ERROR, "Fila {$currentRowNumber}: error al procesar la fila.");
                    }
                }
            } finally {
                $this->endRow();
            }
        }
    }

    protected function normalizeRow(array $row, int $rowNumber): ?array
    {
        $allowedFields = $this->getAllowedFields();
        $customTransforms = $this->customTransformations();
        $normalized = [];

        foreach ($row as $excelHeader => $value) {
            $fieldKey = Str::snake(trim($excelHeader));

            if (!empty($allowedFields) && !in_array($fieldKey, $allowedFields, true) && $fieldKey !== 'id') {
                continue;
            }

            if (isset($customTransforms[$fieldKey]) && is_callable($customTransforms[$fieldKey])) {
                $normalized[$fieldKey] = $customTransforms[$fieldKey]($value, $row, $rowNumber);
            } else {
                $normalized[$fieldKey] = $this->defaultFieldTransform($fieldKey, $value);
            }
        }

        $primaryKey = $this->normalizeKey ?? 'name';
        if (empty($normalized[$primaryKey]) && empty($normalized['id'])) {
            $this->skipRow("Fila {$rowNumber} omitida: falta el identificador principal ({$primaryKey}).");
            return null;
        }

        return $normalized;
    }

    protected function processNormalizedRow(array $normalizedRow, int $rowNumber): void
    {
        $entity = null;

        if (!empty($normalizedRow['id'])) {
            $entity = $this->repository->find($normalizedRow['id']);
        }

        $keyField = $this->normalizeKey ?? 'name';
        if (!$entity && !empty($normalizedRow[$keyField]) && method_exists($this->repository, 'findOrCreateByName')) {
            $entity = $this->repository->findOrCreateByName($normalizedRow[$keyField]);
        }

        if ($entity && $entity->exists) {
            $entity->update($normalizedRow);
        } else {
            $this->repository->insert($normalizedRow);
        }
    }

    protected function defaultFieldTransform(string $field, mixed $value): mixed
    {
        $value = is_string($value) ? trim($value) : $value;

        if (in_array($field, ['is_active', 'status', 'apply_retroactively'], true)) {
            return in_array(strtolower((string) $value), ['activo', '1', 'true', 'sí', 'si'], true);
        }

        if ($field === 'name') {
            return NameHelper::normalize((string) $value);
        }

        return $value ?: null;
    }

    protected function handleProcessingError(array $normalizedRow, \Throwable $e, int $rowNumber): void
    {
        $keyField = $this->normalizeKey ?? 'name';
        $key = $normalizedRow[$keyField] ?? $normalizedRow['id'] ?? 'sin_clave';

        $this->addError("Fila {$rowNumber} [{$key}]: " . $this->publicExceptionMessage($e, $rowNumber));
    }

    /**
     * Mensaje de una excepción apto para el usuario: los errores de filas se
     * muestran a los administradores, así que nunca deben llevar SQL,
     * nombres de tablas, FQCN ni detalles internos de PHP.
     *
     * Lista blanca: solo se muestra el mensaje de
     *   - UserFacingException (escrito para el usuario; puede ser clave i18n),
     *   - ValidationException (mensajes de validación),
     *   - excepciones cuya clase sea EXACTAMENTE \RuntimeException,
     *     \InvalidArgumentException o \DomainException (las que lanza el propio
     *     código de imports con mensajes en español). Las subclases (p. ej.
     *     ModelNotFoundException extiende RuntimeException) NO cuentan.
     * Todo lo demás → mensaje genérico; el detalle técnico queda solo en el log
     * (clase y código, sin datos de la fila ni el mensaje original).
     */
    protected function publicExceptionMessage(\Throwable $e, ?int $rowNumber = null): string
    {
        if ($e instanceof ValidationException) {
            return implode(' ', array_merge(...array_values($e->errors())));
        }

        if ($e instanceof UserFacingException) {
            return (string) __($e->getUserMessage());
        }

        if (in_array(get_class($e), self::PUBLIC_MESSAGE_EXCEPTIONS, true)) {
            return $e->getMessage();
        }

        $public = match (true) {
            $e instanceof UniqueConstraintViolationException => 'ya existe un registro con los mismos datos únicos.',
            $e instanceof QueryException, $e instanceof \PDOException => 'no se pudo guardar la fila en la base de datos.',
            $e instanceof \Error => 'error interno al procesar la fila.',
            default => 'error al procesar la fila.',
        };

        Log::error('[Import] Error interno procesando fila', [
            'import' => static::class,
            'row_number' => $rowNumber,
            'exception' => get_class($e),
            'code' => $e->getCode(),
        ]);

        return $public;
    }

    protected function addError(string $message): void
    {
        $key = md5($message);
        $this->counts[$key] = ($this->counts[$key] ?? 0) + 1;
        if (!in_array($message, $this->errors, true)) {
            $this->errors[$key] = $message;
            Log::error($message);
        }

        $this->recordRowIssue(self::LEVEL_ERROR, $message);
    }

    protected function addWarning(string $message): void
    {
        $this->addLegacyWarning($message);
        $this->recordRowIssue(self::LEVEL_WARNING, $message);
    }

    /**
     * Marca la fila en curso como omitida (no se persiste y no cuenta como
     * exitosa). El mensaje se conserva también en la lista de warnings
     * deduplicada por compatibilidad con import_logs.warnings.
     */
    protected function skipRow(string $message): void
    {
        $this->addLegacyWarning($message);
        $this->recordRowIssue(self::LEVEL_SKIPPED, $message);
    }

    /**
     * Devuelve las incidencias estructuradas acumuladas y vacía el buffer.
     *
     * Cada elemento: row_number (?int), level, message, row_key (?string),
     * data (?array<string,string>).
     */
    public function pullRowIssues(): array
    {
        $issues = $this->rowIssues;
        $this->rowIssues = [];
        $this->currentRowIssueStart = 0;

        return $issues;
    }

    public function getResults(): array
    {
        return [
            'errors' => array_values($this->errors),
            'warnings' => array_values($this->warnings),
            'processed' => $this->totalProcessed,
            // Filas procesadas sin error ni omisión (una fila con warning puede ser exitosa).
            'successful' => $this->successfulRows,
            'skipped' => $this->skippedRows,
            'warning_rows' => $this->warningRows,
            'error_rows' => $this->errorRows,
            'row_issues_dropped' => $this->droppedRowIssues,
        ];
    }

    // -------------------------------------------------------------------------
    // Seguimiento por fila
    // -------------------------------------------------------------------------

    protected function addLegacyWarning(string $message): void
    {
        $key = md5($message);
        $this->counts[$key] = ($this->counts[$key] ?? 0) + 1;
        if (!in_array($message, $this->warnings, true)) {
            $this->warnings[$key] = $message;
            Log::warning($message);
        }
    }

    protected function beginRow(int $rowNumber, array $row): void
    {
        $this->currentRowNumber = $rowNumber;
        $this->currentRowData = $this->snapshotRow($row);
        $this->currentRowKey = $this->resolveRowKey($row);
        $this->currentRowLevels = [];
        $this->currentRowIssueStart = count($this->rowIssues);
        $this->currentRowProcessed = false;
    }

    protected function endRow(): void
    {
        if ($this->currentRowNumber === null) {
            return;
        }

        // Completar el identificador en incidencias registradas antes de conocerlo.
        if ($this->currentRowKey !== null) {
            for ($i = $this->currentRowIssueStart, $n = count($this->rowIssues); $i < $n; $i++) {
                $this->rowIssues[$i]['row_key'] ??= $this->currentRowKey;
            }
        }

        $skipped = $this->currentRowHas(self::LEVEL_SKIPPED);
        $failed = $this->currentRowHas(self::LEVEL_ERROR);

        if ($skipped) {
            $this->skippedRows++;
        }

        if ($failed) {
            $this->errorRows++;
        }

        if ($this->currentRowHas(self::LEVEL_WARNING)) {
            $this->warningRows++;
        }

        if ($this->currentRowProcessed && ! $skipped && ! $failed) {
            $this->successfulRows++;
        }

        $this->currentRowNumber = null;
        $this->currentRowData = null;
        $this->currentRowKey = null;
        $this->currentRowLevels = [];
        $this->currentRowProcessed = false;
    }

    protected function currentRowHas(string $level): bool
    {
        return isset($this->currentRowLevels[$level]);
    }

    /**
     * Registra una incidencia estructurada (sin deduplicar) asociada a la fila
     * en curso; fuera de una fila queda como incidencia a nivel de archivo.
     */
    protected function recordRowIssue(string $level, string $message): void
    {
        if ($this->currentRowNumber !== null) {
            $this->currentRowLevels[$level] = true;
        }

        if (count($this->rowIssues) >= $this->maxBufferedRowIssues()) {
            $this->droppedRowIssues++;

            return;
        }

        $this->rowIssues[] = [
            'row_number' => $this->currentRowNumber,
            'level' => $level,
            'message' => mb_substr($message, 0, static::ISSUE_MESSAGE_MAX_LENGTH),
            'row_key' => $this->currentRowKey,
            'data' => $this->currentRowData,
        ];
    }

    /**
     * Tope del buffer en memoria (protege importaciones síncronas que nunca
     * llaman a pullRowIssues()).
     */
    protected function maxBufferedRowIssues(): int
    {
        return max(1, (int) config('imports.max_row_issues', 5000));
    }

    protected function resolveRowKey(array $row): ?string
    {
        $keyField = $this->normalizeKey ?? 'name';

        foreach ([$keyField, 'id'] as $field) {
            $value = $row[$field] ?? null;

            if (is_scalar($value) && trim((string) $value) !== '') {
                return mb_substr(trim((string) $value), 0, static::ROW_KEY_MAX_LENGTH);
            }
        }

        return null;
    }

    /**
     * Snapshot de la fila original: máx. ROW_DATA_MAX_COLUMNS columnas, claves
     * y valores convertidos a string y truncados.
     *
     * @return array<string,string>|null
     */
    protected function snapshotRow(array $row): ?array
    {
        $data = [];

        foreach (array_slice($row, 0, static::ROW_DATA_MAX_COLUMNS, true) as $key => $value) {
            $key = mb_substr((string) $key, 0, static::ROW_DATA_MAX_KEY_LENGTH);
            $data[$key] = mb_substr($this->stringifyCell($value), 0, static::ROW_DATA_MAX_VALUE_LENGTH);
        }

        return $data === [] ? null : $data;
    }

    protected function stringifyCell(mixed $value): string
    {
        return match (true) {
            $value === null => '',
            is_bool($value) => $value ? 'true' : 'false',
            is_scalar($value) => (string) $value,
            $value instanceof \DateTimeInterface => $value->format('Y-m-d H:i:s'),
            $value instanceof \Stringable => (string) $value,
            default => (string) json_encode($value, JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR),
        };
    }

    public function getTemplateHeaders(): array
    {
        return [];
    }

    public function getExampleRow(): ?array
    {
        return null;
    }
}
