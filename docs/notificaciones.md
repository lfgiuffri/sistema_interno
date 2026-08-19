# Notificaciones

> ⚠️ **Keep in sync.** Backend: `services/push/` (`webpush.service.js`, `push.service.js`) y `services/notificaciones/`. Frontend: `composables/useNotificacionesNavegador.ts`, `public/sw-push.js`, sección Notificaciones de Configuración.

Hay **tres canales** y no son intercambiables: cada uno llega a un lugar distinto.

| Canal | A dónde llega | Necesita |
|---|---|---|
| **Campana in-app** | La app abierta, en vivo (Socket.IO) | nada |
| **Web Push** | El **navegador**, aunque la pestaña esté cerrada | claves VAPID |
| **FCM** | La **app nativa** de Android (APK) | cuenta de Firebase |

Email se suma como cuarto canal donde hay SMTP configurado.

## Por qué «Probar» fallaba en Chrome

El circuito de push estaba armado **solo para la app nativa**: `@capacitor/push-notifications`, que dentro de una pestaña no hace absolutamente nada. En Chrome nunca se registraba un destino, `UserSettings.pushToken` quedaba en `null` y el endpoint de prueba respondía «No hay token de push configurado» — que además no le dice nada útil a alguien que está en un navegador.

Ahora hay dos caminos que conviven: **Web Push** para el navegador y **FCM** para el APK. La prueba intenta los dos y alcanza con que uno tenga destino.

## Web Push: cómo funciona

No interviene ningún tercero. El navegador entrega un **endpoint** propio por dispositivo, y el servidor le manda ahí el mensaje **cifrado** (`aes128gcm`) y **firmado** con un par de claves VAPID que generamos nosotros. El servicio de push del navegador es un simple repartidor: no puede leer el contenido.

```
Navegador                       Servidor                     Servicio de push
   │  activar notificaciones       │                              │
   ├──────────────────────────────►│  GET clave pública           │
   │◄──────────────────────────────┤                              │
   │  subscribe(clave) ────────────┼─────────────────────────────►│
   │◄─ endpoint + claves ──────────┼──────────────────────────────┤
   ├─ POST /settings/push/suscripcion ►│  guarda la suscripción    │
   │                               │                              │
   │                               │  enviar ────────────────────►│
   │◄──────────── el service worker muestra la notificación ──────┤
```

### Configuración (una sola vez, en el `.env` del servidor)

```bash
npx web-push generate-vapid-keys
```

```bash
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:soporte@positivemedia.com.ar
```

⚠️ **Estas claves no se rotan.** La pública queda grabada dentro de la suscripción de cada navegador: si cambian, todas las suscripciones existentes dejan de servir y hay que volver a activarlas una por una. Sin ellas el servidor arranca igual y lo avisa por log, pero el canal queda apagado.

### Lo que exige el navegador y no se puede esquivar

- **HTTPS** (o `localhost`). En producción ya está.
- **Un gesto del usuario** para pedir permiso: no se puede pedir al cargar la página.
- Si el usuario **rechaza**, la app NO puede volver a preguntar. Se cambia desde el candado de la barra de direcciones. Por eso la pantalla, cuando detecta ese estado, explica dónde tocar en vez de ofrecer un botón que no haría nada.
- **Se activa por dispositivo**, no por cuenta: el permiso lo da el navegador. Hay que activarlo en cada compu.

### Detalles de implementación

- **Un service worker por scope**: el de la PWA es el mismo que recibe los push. El handler vive en `public/sw-push.js` y se suma con `workbox.importScripts` — aparte, porque el SW generado se reescribe en cada build.
- **`userVisibleOnly: true`** es obligatorio en Chrome: es el compromiso de que todo push muestre algo visible.
- **Al tocar la notificación** se reutiliza la pestaña abierta en vez de abrir una nueva; si no, se juntan diez pestañas del mismo sistema.
- **Las suscripciones muertas se borran solas**: ante un 404 o 410 del servicio de push, la fila se elimina. Cualquier otro error es transitorio y la suscripción se conserva.
- **El endpoint es único**: el mismo navegador re-suscribiéndose actualiza sus claves; si la suscripción venía de otro usuario (una compu compartida), cambia de dueño.

## Endpoints

```
GET    /settings/push/clave-publica    clave VAPID pública (la necesita el navegador)
POST   /settings/push/suscripcion      registra este navegador
DELETE /settings/push/suscripcion      lo da de baja (body: { endpoint })
POST   /settings/test-notification     prueba: intenta navegador Y app nativa
```

Son **personales**, sin capability: cada uno administra los suyos, como el resto de `/settings`.

## Cómo probarlo de verdad

Lo que se puede automatizar está cubierto en los tests (`m09-settings.spec.ts`): la clave publicada, el alta/baja de suscripciones, la unicidad por endpoint y que el mensaje de error sea accionable. El envío real —firma VAPID y cifrado— se verificó contra un servicio de push simulado por HTTPS.

Lo que **no** se puede automatizar es el permiso real del navegador: Chromium headless lo deniega siempre. Para comprobarlo a mano:

1. Entrar por **HTTPS** (o `localhost`) con Chrome.
2. Configuración → Notificaciones → **Activar**, y aceptar el permiso.
3. **Enviar prueba**. Tiene que aparecer la notificación del sistema operativo.
4. Cerrar la pestaña y volver a probar desde otro dispositivo: la notificación llega igual, porque la entrega el service worker y no la página.
