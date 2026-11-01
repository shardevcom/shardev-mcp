# Backlog de operaciones

Acciones pendientes para que `shardev` sustituya los scripts de shell con los que se suele operar un proyecto Laravel + React + AWS ECS. Se ordena por dependencia y riesgo; el esfuerzo es una estimación, no una medición.

Niveles: T0 lectura local, T1 lectura AWS, T2 cambio local o fuera de producción, T3 cambio en producción. En `command-only`, las operaciones que cambian algo devuelven un comando `shardev` para que lo ejecute una persona.

## Ya disponible

`ops_status`, `log_read`, `ops_services`, `ops_tasks`, `ops_logs` (grupo de logs configurable por entorno con `log_group_prefix`), `ops_env_check` (ENV-01: validación local de un entorno, sin AWS; `root` opcional en `projects.yaml`), `ops_ci_check` y `ops_ci_generate` (CI-01: workflows de despliegue desde una plantilla del proyecto; en producción el MCP no escribe), `shardev ops status|services|tasks|logs|env-check|ci-check|ci-generate|log-read`, `project_*` y `app_*`. Las ejecuciones por CLI también quedan en `audit.jsonl` (`source: "cli"`; ADJ-09).

## 1. Ajustes a lo existente

| ID | Tarea | Por qué | Esfuerzo |
|---|---|---|---|
| ADJ-02 | Medir la redacción con logs reales que contengan datos sensibles | La lectura real ya funciona, pero las muestras no tenían nada que enmascarar, así que no prueban la redacción | Bajo |

## 2. Base de cambios

Requisito de todas las operaciones que modifican AWS.

| ID | Tarea | Criterio de cierre | Esfuerzo |
|---|---|---|---|
| BASE-01 | Primera operación T3 real con `requiresUserInteraction` y `commandOnlyResponse` | La herramienta devuelve un comando `shardev` sin ejecutar nada | Medio |
| BASE-02 | Confirmación humana en la CLI | Exige TTY y no acepta respuestas por tubería | Bajo |
| BASE-03 | Implementar `gated-apply` | Plan firmado, confirmación por llamada, auditoría y modo más restrictivo garantizado | Alto |
| BASE-04 | Modo de proyecto adoptado | Un proyecto existente declara sus pasos de verificación, sin lock falso, y `app_create` sigue bloqueado | Medio |

## 3. Migración de acciones

| ID | Acción | Nivel | Notas | Esfuerzo |
|---|---|---|---|---|
| ENV-02 | Crear un entorno a partir de otro | T2 | Genera contraseñas nuevas; rechaza producción como destino | Medio |
| ENV-03 | Dividir un `.env` en configuración y secretos | T2 | Con copia de seguridad | Bajo |
| ENV-04 | Adoptar o crear un perfil AWS | T2 | Nunca borra una credencial que no se haya guardado antes | Medio |
| CI-02 | Comparar y aplicar variables del entorno de GitHub | T1/T2 | Los secretos solo se comprueban por nombre | Medio |
| SVC-01 | Forzar un despliegue nuevo de los servicios | T3 | Primera candidata para BASE-01 | Bajo |
| SVC-02 | Cambiar `desired-count` (levantar y apagar) | T3 | Apagar deja el entorno fuera de línea | Bajo |
| SEC-01 | Listar y programar el borrado de secretos antiguos | T1/T3 | Con ventana de recuperación | Medio |
| SEC-02 | Sincronizar secretos | T3 | Sin valores en argumentos de proceso; reiniciar servicios debe ser explícito | Alto |
| DEP-01 | Construir y publicar la imagen | T3 | Etiquetas inmutables por commit | Medio |
| DEP-02 | Preparar ALB, IAM, logs y task definitions | T3 | Separar lo compartido entre proyectos | Alto |
| DEP-03 | Preparar base de datos y Redis | T3 | No restablecer contraseñas en cada despliegue; sin interpolar secretos en SQL | Alto |
| DEP-04 | Orquestar el despliegue completo | T3 | Depende de DEP-01 a DEP-03 y SVC-01 | Alto |
| RUN-01 | Comandos de artisan en un contenedor | T1/T3 | Lista de permitidos; prohibir los que borran datos | Medio |
| RUN-02 | Shell interactiva en un contenedor | Solo CLI | Necesita TTY; nunca desde el MCP | Bajo |
| RUN-03 | Descargar un archivo de un contenedor | Solo CLI | Lista de permitidos; excluir archivos con secretos | Bajo |
| RUN-04 | Túnel a la base de datos | Solo CLI | Entorno obligatorio; detener el bastión al salir | Medio |
| DEL-01 | Borrar un entorno | Solo CLI | Plan previo, confirmación escrita con el nombre, informa cada fallo y no toca recursos compartidos | Medio |
| LOC-01 | Estado y logs locales | T0 | | Bajo |
| LOC-02 | Levantar, detener y reconstruir el entorno local | T2 | Comprobar que la base es local antes de migrar; gestionar procesos largos | Medio |
| LOC-03 | Reiniciar datos y borrar volúmenes locales | Solo CLI | Solo volúmenes del proyecto, no `prune` global | Bajo |
| MOB-01 | `mobile_add`: capa Capacitor para Android e iOS | T2 | iOS solo se puede verificar en macOS | Alto |
| MOB-02 | Compilar e instalar en dispositivo o emulador | T2 | No desinstalar sin avisar | Medio |
| MOB-03 | Publicar en tiendas | T3 | Confirmación explícita; preferir el flujo de CI | Medio |
| REL-01 | Preparar una versión: subir versiones, rama y PR | T2 | Sin tocar la rama de producción | Medio |
| REL-02 | Abrir el PR de la versión hacia producción | T3 | Comprobar versión y ramas | Bajo |
| MAIL-01 | Configurar SES y SNS | T3 | Simulación por defecto | Medio |
| MAIL-02 | Configurar correo entrante y DMARC | T3 | Simulación por defecto; nunca sobrescribir el MX raíz sin confirmación | Medio |
| UI-01 | `ui_status`, `ui_plan`, `ui_apply` para componentes shadcn/ui por app | T0/T2 | Sin sobrescribir componentes personalizados | Medio |
| TPL-01 | Plantillas de despliegue para proyectos generados | T2 | Hoy no incluyen `.aws`, CI ni scripts de despliegue. Incluye la plantilla de workflow por defecto (`.github/templates/deploy.template.yml`): CI-01 solo renderiza la que aporta el proyecto y no trae ninguna | Alto |

## Orden recomendado

1. ADJ-02.
2. BASE-01, BASE-02 y SVC-01 como primera operación que cambia AWS; luego SVC-02.
3. Resto de ENV y CI, LOC y REL.
4. SEC, DEP y TPL-01.
5. RUN, DEL, MOB, MAIL y UI según necesidad.

BASE-03 y BASE-04 se abordan cuando una operación concreta los necesite.
