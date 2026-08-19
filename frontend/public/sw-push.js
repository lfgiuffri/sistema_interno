/**
 * Manejo de Web Push en el service worker.
 *
 * Este archivo lo carga el SW que genera vite-plugin-pwa (`workbox.importScripts`). Va aparte
 * y no dentro del generado porque ese se reescribe en cada build.
 *
 * Solo puede haber UN service worker por scope, así que el de la PWA (que cachea el shell) es
 * el mismo que recibe los push: por eso se agrega acá y no registrando otro.
 */

/* global self, clients */

self.addEventListener('push', (event) => {
    // Sin datos no se muestra nada: Chrome exige que TODO push visible muestre una
    // notificación (`userVisibleOnly`), pero un push vacío sería ruido.
    if (!event.data) return;

    let datos;
    try {
        datos = event.data.json();
    } catch {
        datos = { titulo: 'Sistema Interno', cuerpo: event.data.text() };
    }

    event.waitUntil(
        self.registration.showNotification(datos.titulo || 'Sistema Interno', {
            body: datos.cuerpo || '',
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-96.png',
            // El tag agrupa: dos avisos del mismo tipo se reemplazan en vez de apilarse.
            tag: datos.tag || 'sistema-interno',
            data: { url: datos.url || '/' },
        }),
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const destino = event.notification.data?.url || '/';

    event.waitUntil((async () => {
        const ventanas = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        // Si la app ya está abierta se reusa esa pestaña: abrir una nueva cada vez que se
        // toca una notificación termina en diez pestañas del mismo sistema.
        for (const v of ventanas) {
            if (v.url.includes(self.location.origin)) {
                await v.focus();
                if ('navigate' in v) await v.navigate(destino).catch(() => null);
                return;
            }
        }
        await clients.openWindow(destino);
    })());
});
