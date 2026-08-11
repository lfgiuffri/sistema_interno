# Realtime — Zero 2.0

> ⚠️ **Keep in sync.** Bootstrap de Socket.IO en `index.js`; presencia/broadcast en `kernel/realtime/presence.js`; registro de handlers en `socket/socketHandlers.js` + `kernel/handlerRegistry.js`.

Realtime sobre **Socket.IO**, estrictamente aislado por tenant.

## Conexión y auth

```js
import { io } from 'socket.io-client';
const socket = io(API_URL, { auth: { token: accessToken } });
```

En el handshake (`index.js`), el server verifica el JWT, extrae `tenantId`/`userId`, valida que el tenant esté `active`, une el socket a su **room personal** `${tenantId}:${userId}`, y programa una desconexión automática cuando el token expira (emite `auth:expired`). Payloads multimodales hasta 10MB (`maxHttpBufferSize`).

## Rooms

- **Personal**: `${tenantId}:${userId}` — los controllers emiten acá las mutaciones del usuario (ej. `item:created`).
- **Tenant**: `tenant:${tenantId}` — para eventos que ven todos los usuarios del tenant (presencia).
- **Broadcast**: `broadcast:${tenantId}:${channel}` — canal lógico tenant-scoped.

La autorización es **estructural**: el `tenantId` lo setea el server al autenticar, nunca el cliente → imposible escuchar/publicar en el room de otro tenant.

## Handlers por módulo

Los handlers de socket los aportan los módulos vía `registerSocketHandler((socket, io) => {...})` (manifest `socketHandler` o el barrel del kernel). El core los invoca por cada conexión autenticada. Con cero módulos, no hay handlers (no-op).

## Presencia + broadcast (`kernel/realtime/presence.js`)

Infra que se registra en el boot (`registerPresence()` en `index.js`). Estado de presencia en memoria por proceso (efímero; se reinicia con el proceso). Soporta multi-tab: el usuario sigue online mientras tenga ≥1 conexión.

| Evento (cliente → server) | Qué hace |
|---------------------------|----------|
| `presence:list` (ack) | devuelve los userIds online del tenant |
| `broadcast:subscribe` `{ channel }` | suscribe al canal (tenant-scoped) |
| `broadcast:unsubscribe` `{ channel }` | desuscribe |
| `broadcast:send` `{ channel, payload }` | reenvía a los suscriptores del canal del mismo tenant |

| Evento (server → cliente) | Cuándo |
|---------------------------|--------|
| `presence:join` `{ userId, online }` | un usuario del tenant pasa a online |
| `presence:leave` `{ userId, online }` | un usuario queda sin conexiones |
| `broadcast:${tenantId}:${channel}` `{ channel, from, payload }` | un par publica en el canal |
| `auth:expired` | el token del socket expiró (reconectar con token fresco) |

## Variables de entorno

```
CORS_ORIGIN=*          # origen permitido para Socket.IO
```
