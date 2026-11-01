# 0007 - Lecturas AWS: `ops_services`, `ops_tasks`, `ops_logs`

Fecha: 2026-11-01. Alcance: tres herramientas T1 de solo lectura (ECS y CloudWatch Logs) y su CLI (`shardev ops ...`). Fuera de alcance: cualquier operación que cambie AWS, `gated-apply`, modo de adopción de proyectos existentes y descubrimiento de servicios (`list-services`).

## Operaciones permitidas

Solo cuatro, como array de argumentos (nunca shell ni subcomandos que venga del llamador), con `--profile`, `--region`, `--output json` y `--no-cli-pager`: `ecs describe-services`, `ecs list-tasks`, `ecs describe-tasks`, `logs filter-log-events` (más el `sts get-caller-identity` de la política). La lista vive en `src/core/aws-read.ts` y un test comprueba que todo argv que llega al runner está en ella. Los ARN que devuelve `list-tasks` se validan antes de pasarlos a `describe-tasks`.

## Por qué `services` en `ops.yaml`

Un `service_prefix` único no separa entornos: con cluster y cuenta compartidos, el prefijo `demo-` de producción también coincide con `demo-staging-app`. Cada entorno declara ahora `services: [...]` (nombres exactos). Un servicio es válido para un entorno solo si empieza por el prefijo **y** está en esa lista (`assertServiceName(manifest, env, service)`). Cada servicio listado debe empezar por el prefijo (se valida al parsear), sin duplicados.

- **Actualiza el CLI antes de añadir `services`:** el esquema de entornos sigue siendo estricto (no se relajó), por lo que una versión anterior rechaza el `ops.yaml` con `Unrecognized key`.
- Es opcional en el esquema para que los manifests existentes sigan parseando y `ops_status` siga funcionando.
- Las herramientas nuevas **fallan cerradas** sin `services`, con un mensaje que dice qué añadir. No hay descubrimiento con `list-services`: la lista la fija el dueño del proyecto, no la nube.
- `capabilities` ahora se aplica: `ops_services` y `ops_tasks` exigen `ecs`; `ops_logs` exige `logs`.
- `env` es obligatorio en las tres herramientas, sin default.

## Semántica de lectura bajo `command-only`

`decide()` no cambia. Para estas herramientas se ejecuta cuando la decisión es `allowed`, incluido el modo efectivo `command-only` y también en producción: `command-only` significa "los cambios no se ejecutan", no "no se puede leer". `disabled` (política, perfil de producción no listado, `policy.yaml` inválida), `unavailable` (sin sesión o error de identidad) y `rejected` (cuenta distinta) bloquean antes de cualquier llamada a ECS/CloudWatch; en esos casos solo se pudo haber consultado `sts`. Las validaciones locales (proyecto, env, capacidad, servicio declarado) ocurren antes que la política. Las notas de `decide()` no se reenvían en las lecturas, porque la de `gated-apply` afirma que "nada se ejecuta"; el resultado lleva en su lugar `policy.requested_mode` y una nota que lo aclara.

## Qué devuelve cada herramienta

Lista blanca explícita de campos; cualquier otro (p. ej. `overrides`, variables de entorno, redes, balanceadores) se descarta aunque la API lo devuelva.

- `ops_services`: servicio, estado, conteos, task definition como `familia:revisión`, despliegues (estado, `rolloutState`, conteos, fallidas, `updatedAt`), últimos 5 eventos y `failures` de la API (servicio y motivo). Lotes de 10. Los mensajes de eventos se marcan como no confiables con el aviso estándar y se redactan.
- `ops_tasks`: hasta 20 tareas (`RUNNING` por defecto, o `STOPPED`); lista vacía no llama a `describe-tasks`. Id corto, estados, `familia:revisión`, horas, `stopCode`, `stoppedReason` y contenedores (nombre, estado, `exitCode`, `reason`).

## Logs: manejo y retención

- Grupo `<log_group_prefix><servicio>`. Por defecto `/ecs/` (la convención del driver `awslogs` de las plantillas), así que los manifests existentes no cambian. `log_group_prefix` es opcional por entorno en `ops.yaml`; se valida al parsear (`^[A-Za-z0-9_./#-]{1,200}$` y sin `..`: sin espacios, caracteres de control ni cadena vacía). El servicio sigue pasando `assertServiceName` (prefijo del proyecto y lista `services` del entorno), por lo que el prefijo no permite leer grupos de servicios no declarados. **Mismo orden de actualización que `services`:** el esquema es estricto, una versión anterior rechaza la clave (`Unrecognized key`); actualiza el CLI antes de añadirla.
- Límites: `since_minutes` 1-1440 (60), `limit` 1-1000 (200), `filter` literal de hasta 200 caracteres sin caracteres de control. El filtro se envía entrecomillado con `\` y `"` escapados, de modo que no puede inyectar sintaxis de filtro de CloudWatch (`||`, `{ $.x }`, `-término`, `?`). Los instantes se calculan con `ctx.now()`.
- **Siempre los eventos más nuevos.** `filter-log-events` lee en orden ascendente desde `--start-time`, así que `--max-items` conservaría el INICIO de la ventana (los más viejos). Por eso se recorre la ventana hacia atrás desde ahora en subventanas disjuntas de 5, 15 y 30 minutos y luego el doble cada vez (recortadas a `since_minutes`), cada una con `--start-time`/`--end-time` y un tope de escaneo fijo e interno de 1000 eventos (`--max-items`). Como `--end-time` es inclusivo, cada subventana termina 1 ms antes de que empiece la anterior: no hay duplicados en los bordes. Se para en cuanto hay al menos `limit` eventos y se guardan los `limit` más nuevos, ascendentes. `truncated` significa "hay eventos más antiguos en la ventana que no se devolvieron": es cierto si se reunieron más de `limit`, o si se reunieron exactamente `limit` y una sonda de 1 evento (`--max-items 1`) sobre el resto de la ventana encuentra alguno.
- **Tope de escaneo.** Una subventana que devuelve `NextToken` solo trajo su principio (lo más viejo), así que se descarta y se divide en dos mitades (primero la más nueva), recursivamente. Si no se puede dividir más (1 ms) o se agota el presupuesto de 24 consultas de escaneo, la herramienta falla con un mensaje claro ("reduce `since_minutes` o añade un `filter`"); nunca devuelve eventos que no sean los más recientes. Todas las consultas siguen siendo `logs filter-log-events`.
- El contenido es dato del cliente: **no aparece en el resultado**. Se guarda con `LogStore` (redactado, archivo 0600) y se devuelve conteo, `truncated`, primer y último timestamp y `log_ref`; se lee con `log_read`, que lo marca como no confiable.
- Retención (ADJ-06): la purga también corre al iniciar `shardev mcp serve`, en cada comando `shardev ops ...` y en cada `log_read` / `ops log-read` (`purgeExpiredOpsLogs`, best-effort: nunca lanza ni hace fallar el comando; constantes en `src/ops/log-retention.ts`). Además `log_read` rechaza con el "no existe" normal una copia de `ops_logs` cuya marca de tiempo del nombre supere los 7 días, aunque la purga haya fallado. **Límite:** no hay demonio, temporizador ni cron; si no se ejecuta ninguno de esos comandos, los archivos vencidos siguen en disco hasta la próxima ejecución, así que no es un plazo de borrado garantizado.
- Retención base: cada llamada a `ops_logs` que pasa la política borra los archivos de esta herramienta con más de 7 días (`LogStore.purgeOlderThan`). Solo toca archivos regulares cuyo nombre coincide exactamente con el que genera `write` para la etiqueta `ops-logs-<servicio>`; la edad sale de la marca UTC del nombre (no del mtime), los symlinks, directorios y logs de otras herramientas se ignoran, y un fallo de purga no hace fallar la llamada. Para poder hacerlo con un reloj coherente, `createContext` ahora pasa su `now` a `LogStore` (cambio mínimo: antes usaba su propio reloj).

## Límites conocidos

- La redacción de secretos no detecta datos personales; para eso existe el enmascarado de la sección "Datos personales en `ops_logs`" (reduce exposición, no anonimiza).
- El texto de `filter` queda en la auditoría tal como lo deja la redacción estándar de `AuditLog` (recorte a 200 caracteres y redacción por patrones y por nombre de clave); un valor sensible sin forma reconocible escrito en el filtro quedaría en `audit.jsonl`. No pongas secretos en `filter`.
- `stoppedReason` y `reason` de contenedores vienen de AWS pero pueden incluir texto de la aplicación; se redactan y se marcan como no confiables.
- La salida del CLI de AWS está limitada por el límite de `exec` (8 MiB); si se supera, la herramienta falla pidiendo reducir `limit` o `since_minutes`.

## Datos personales en `ops_logs` (ADJ-05)

Además de la redacción de secretos, el contenido de `ops_logs` se enmascara **antes de guardarse** con `maskPersonalData` (`src/core/pii-mask.ts`). Solo se aplica a esta herramienta: el `Redactor` global, la salida de comandos y los demás logs no cambian. No existe ningún parámetro, flag ni variable que lo desactive (un agente podría usarlo). Se aplica al mensaje de cada evento, no a la marca de tiempo ni a la cabecera, y después de redactar secretos (así `usuario:clave@host` no se confunde con un correo).

**Qué se detecta**
- Correos electrónicos => `[EMAIL]`.
- 7 o más dígitos seguidos, con `+` inicial opcional => `[NUMERO]`.
- Grupos de dígitos separados por un espacio o guion (`+57 300 123 4567`, `300-123-4567`; tras el primer grupo, grupos de 2 a 4 dígitos) con 9 o más dígitos en total => `[NUMERO]`.

**Qué se conserva a propósito**: fechas y horas ISO 8601, UUID, y números cortos (estados HTTP, puertos, duraciones, conteos de menos de 7 dígitos; un decimal como `1234567.89` o `3.14159265` tampoco se toca). Los identificadores pegados a letras o `_` (`req_1234567`, `abc1234567`) no se enmascaran.

**Decisiones y compromisos**
- *Epoch.* Un epoch de 10 o 13 dígitos que empieza por 1 es indistinguible de un teléfono o documento. Solo se conserva si la clave inmediatamente anterior indica tiempo (`ts`, `time`, `timestamp`, `epoch`, `date`, `*_at`, `iat`, `exp`, `nbf`, `duration`, `latency`...); sin clave se enmascara. Se prefirió perder algún epoch a dejar pasar un documento de identidad.
- *ID numéricos largos* (pedidos, usuarios, trazas numéricas de 7+ dígitos) y fechas compactas (`20261101`) se enmascaran: se pierde la capacidad de correlacionarlos entre eventos. Es el precio de la regla conservadora.
- *Grupos con espacios.* `200 1234 5678` se interpreta como un solo número; un estado HTTP pegado a otros grupos de dígitos puede quedar absorbido.
- Los falsos positivos son preferibles a los falsos negativos; los falsos negativos existen (ver abajo).

**Qué NO se detecta**: nombres de personas, direcciones postales, nombres de empresa, texto libre, usuarios o alias sin forma de correo, números con formatos distintos (letras intercaladas, separadores raros), datos en base64/JSON codificado, direcciones IP (se consideran datos técnicos). **Esto reduce la exposición pero no es anonimización**: no debe tratarse el contenido guardado como libre de datos personales.

**Resultado y límites**
- El resultado de `ops_logs` solo incluye `personal_data_masked` (cantidad de coincidencias enmascaradas), nunca los valores.
- El texto de `filter` **no** se enmascara: se envía tal cual a CloudWatch (la búsqueda es en el servidor) y queda en la auditoría con la redacción estándar. Si contiene un correo o un número, ese dato consta en la consulta y en `audit.jsonl`; evita poner datos personales en `filter`. La cabecera del archivo guardado no incluye el filtro (solo si se aplicó, `filter_applied`, en el resultado).
- El enmascarado es idempotente (`[EMAIL]` y `[NUMERO]` no contienen @ ni dígitos), y `log_read` devuelve el texto ya enmascarado.
