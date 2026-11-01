# Arquitectura

- Monolito modular. Código de dominio en `packages/shardevcom/*`; `app/` solo lleva pegamento de la aplicación (modelos de cuenta por app, controladores de auth por app, proveedores, middleware).
- `supports` y `repositories` son el núcleo compartido: cualquier paquete puede depender de ellos. Entre paquetes de dominio, comunica por eventos/listeners o por contratos en `supports`, no importando clases internas.
- Capas: Controller (delgado) -> Repository (acceso a datos + autorización) -> Service (lógica de negocio) -> Model. No consultes Eloquent desde un controlador.
- Un paquete nuevo copia la forma de uno existente (`src`, `config`, `routes`, `database/migrations`, ServiceProvider con `extra.laravel.providers`) y se declara en el `composer.json` raíz.
- Cada app tiene su Vite config (`resources/react/<app>/vite.config.ts`), su puerto, su build dir, su hot file y sus alias. Las apps no comparten componentes: cada una gestiona su `components/ui`.
- Los paquetes copiados registran un hash en `.ops/lock.yaml`; si los modificas en este repo, es una divergencia consciente: documéntala.
