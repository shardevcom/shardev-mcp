import { createApp } from '@shardev/common';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { PageRouter } from './pages';
import { rootSlices } from './reducers';

const AppComponent = createApp({
    name: '{{ app.key }}',
    app: PageRouter,
    slices: rootSlices,
    // Solo separa el almacenamiento local de esta app. No es un secreto ni da confidencialidad:
    // todo lo que va al bundle del navegador es público.
    appKey: '{{ project.name }}-{{ app.key }}-state',
});

const el = document.getElementById('root');

if (el) {
    // Una sola raíz de React aunque el módulo se evalúe más de una vez (HMR).
    const globalWindow = window as unknown as { __reactRoot?: ReturnType<typeof createRoot> };
    globalWindow.__reactRoot ??= createRoot(el);
    globalWindow.__reactRoot.render(
        <React.StrictMode>
            <AppComponent />
        </React.StrictMode>,
    );
}
