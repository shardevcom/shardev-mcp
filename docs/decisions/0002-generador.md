# 0002 - Núcleo del generador (fase 3)

Fecha: 2026-11-01. Alcance: spec, capas, renderer, plan/apply, verify y herramientas `project_*`. Las plantillas reales quedan fuera (fase posterior).

## Correcciones al motor de la fase 2

- **Gate de producción.** `is_production` del `ops.yaml` ya no es la única fuente: un entorno es producción si el manifest lo dice, **o** su nombre cumple `/^prod(uction)?$/i`, **o** está en `production_envs` del proyecto en `projects.yaml` (config del dueño). Producción gana ante cualquier conflicto y el resultado lo indica (`production_conflict`). `account_id` no discrimina (staging y producción comparten cuenta). Limitación: un entorno de producción con un nombre distinto (`live`) solo se detecta si el dueño lo lista en `production_envs`.
- **Redacción.** Se añaden `nombre: valor` (YAML/log, con o sin comillas; solo espacios tras `:` para no tragar la línea siguiente) y credenciales en URLs. Prefiere enmascarar de más.

## Decisiones de diseño

1. **Integridad del plan.** El plan se firma con HMAC-SHA256 (clave en `plan.key`, 0600) y al aplicar se regenera todo (plantillas, destino, salida) y se compara con lo guardado. Limitación explícita: la clave está en el mismo usuario, así que un proceso con acceso total a ese usuario podría forjar un plan; detecta manipulación accidental o ingenua, no a un atacante con el mismo UID. La barrera real son `allowed_roots` (config del dueño), el tier T2 y que `project_create` solo acepta un `plan_id`.
2. **Un plan con conflictos no se guarda** (`plan_id: null`). Errores de plantilla (variable desconocida, requerida sin usar, bloque sin cerrar, destino con traversal) lanzan error; problemas de cableado y colisiones de archivos son conflictos.
3. **`master`/`main`.** Interpretación literal de "nunca basar trabajo en master/main": el plan sobre un repo existente se rechaza si la rama actual es `master`/`main` (hay que partir de `develop` u otra). Siempre se crea una rama nueva `shardev/...`.
4. **Sin commit** en el repo existente: los cambios quedan en la rama nueva sin commitear para que el humano los revise. Si algo falla se restauran los archivos, se vuelve a la base y se borra la rama creada por la propia ejecución.
5. **`project_verify` no confía en el lock para qué ejecutar**: los pasos salen de las plantillas actuales; del lock solo se leen spec, capas y la lista de archivos (validada contra traversal) a escanear.
6. **Runner único.** `git` y los pasos de verificación usan el mismo `Runner` (`exec`) que AWS; en tests del servidor se inyecta `exec` real cuando hace falta.
7. **`platforms` de mobile** es una lista (`android`, `ios`), al menos una. `key` de app: `^[a-z][a-z0-9]{0,30}$` (empieza por letra porque deriva clases/tablas). También se rechazan `provider` y `modelo` duplicados entre apps.
8. **Escaneo de secretos**: falsos positivos posibles (p. ej. `password: 'password'` en una factory); se resuelve con el marcador `shardev-allow-secret` en la línea. Los hits solo informan ruta y línea, nunca el contenido.
9. Los pasos de `verify` no pueden referenciar la ruta de salida (no hay variable `root`); solo env literal explícito por paso.

## No hecho / abierto

- Plantillas reales; la herramienta `app_create` (el motor `planExisting`/`applyExisting` ya existe y está probado).
- Ejecución real de composer/npm/docker sobre proyectos generados: no se probó (fuera de alcance).
