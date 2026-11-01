import type { StoreContextType } from '@shardev/common';

type Store = StoreContextType['store'];
type Persistor = StoreContextType['persist'];
type Purge = StoreContextType['purge'];

/**
 * Purgar todo almacenamiento cliente en el logout.
 */
export function clearAllStorage(): void {
    try {
        window.localStorage.clear();
        window.sessionStorage.clear();
    } catch (error) {
        console.warn('Error limpiando almacenamiento en logout:', error);
    }
}

let stopWaitingForSession: (() => void) | null = null;

/**
 * el logout pausa redux-persist para que no vuelva a escribir el
 * estado reseteado después de purgar el storage. Se reanuda en cuanto el store
 * vuelve a tener una sesión, venga del login que venga, sin depender de qué
 * pantalla esté montada. Sin esto la sesión nueva solo vivía en memoria y
 * cualquier recarga la perdía.
 */
export function resumePersistenceOnNextSession(store: Store, persistor: Persistor): void {
    if (stopWaitingForSession) return;

    stopWaitingForSession = store.subscribe(() => {
        const state = store.getState() as { auth?: { authUser?: { access_token?: string } } };
        if (!state.auth?.authUser?.access_token) return;

        stopWaitingForSession?.();
        stopWaitingForSession = null;
        persistor.persist();
    });
}

/**
 * borra del navegador la sesión y los datos cacheados en el logout.
 *
 * redux-persist escribe de forma asíncrona (cola + setInterval) y `pause()` no
 * cancela lo que ya está en cola: una escritura pendiente llegaba después de
 * `localStorage.clear()` y volvía a crear `persist:*` (incluso con el token
 * anterior). Por eso el orden es: vaciar la cola (`flush`) → pausar → resetear
 * el estado en memoria (ya sin escribir nada) → purgar → limpiar todo el storage.
 */
export async function wipeSessionStorage(
    { store, persistor, purge }: { store: Store; persistor: Persistor; purge: Purge },
    resetState: () => void,
): Promise<void> {
    try {
        await persistor.flush();
    } catch (flushError) {
        console.warn('Error vaciando escrituras pendientes en logout:', flushError);
    }

    persistor.pause();
    resetState();
    resumePersistenceOnNextSession(store, persistor);

    try {
        await purge();
    } catch (purgeError) {
        console.warn('Error purgando el estado persistido en logout:', purgeError);
    }

    clearAllStorage();
}
