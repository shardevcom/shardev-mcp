# Frontend

- `resources/react/<app>` con `pages/`, `layouts/`, `components/`, `hooks/`, `reducers/`, `routes/`, `types/`, `utils/`. No importes de una app a otra: si algo se comparte, va a un paquete.
- TypeScript estricto (`strict`, `noImplicitAny`); no lo relajes. Comprueba con `pnpm run types`.
- Estado con Redux Toolkit vía `@shardev/common` (`createApp`). No añadas secretos o tokens nuevos al estado persistido: `localStorage` equivale a texto plano para el modelo de amenazas.
- Permisos en la UI (`useAuth().hasPermission`) son comodidad, no autorización.
- Validación del formulario es UX; el backend valida siempre.
- No uses `dangerouslySetInnerHTML` con contenido de usuario. No dejes `console.log` de tokens ni de payloads decodificados.
- Componentes UI: cada app tiene su copia en `components/ui` (estilo shadcn); añade con el CLI de shadcn de esa app.
