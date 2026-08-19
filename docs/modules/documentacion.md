# Módulo `documentacion`

> ⚠️ **Keep in sync.** Backend en `backend/src/modules/documentacion/`; frontend en `frontend/src/views/documentacion/` + `stores/documentacion.ts`; e2e en `e2e/tests/api/m19-documentacion.spec.ts`.

Base de conocimiento de la empresa: **espacio → lista → documento**. Vive en el grupo **Proyectos** del menú, al lado de Tareas.

## Modelo mental

| Nivel | Qué es | Tabla |
|-------|--------|-------|
| **Espacio** | Recorte temático con acceso por usuario (ej. «Procesos internos») | `doc_espacios` + `usuario_doc_espacios` |
| **Lista** | Agrupador con título dentro del espacio (ej. «Onboarding») | `doc_listas` |
| **Documento** | Título + cuerpo enriquecido y/o adjuntos | `documentos` (+ `documento_archivos`, `documento_versiones`) |

Los espacios son **propios del módulo**: NO son los `espacios_trabajo` de tareas. Un espacio de documentación puede no tener ningún tablero de tareas equivalente, y sus permisos se administran aparte.

## Permisos: dos capas

Igual que tareas: **capability Y permiso del espacio**.

1. **Capa 1 (capability, por ruta)**: `documentacion:read|create|update|delete`.
2. **Capa 2 (espacio, en el service)**: `ver` / `editar` en `usuario_doc_espacios`. `editar` implica `ver`; los administradores (rol con `*`) entran a todos los espacios por su rol y **no llevan fila** (si la tuvieran aparecerían dos veces en el listado de accesos); el creador NO admin queda con acceso total al espacio que crea.

La ADMINISTRACIÓN de espacios tiene capabilities separadas —`doc-espacios:read|create|update|toggle|delete|asignar-usuarios`— porque repartir accesos no es lo mismo que escribir documentación: alguien puede documentar mucho sin poder decidir quién entra.

Cada respuesta de listado trae `puedeEditar` para que el frontend gatee los botones sin adivinar.

## Endpoints

```
GET    /documentacion/espacios                                     home (espacios visibles + conteos)
GET    /documentacion/buscar?q=&docEspacioId=&limit=               buscador (título y contenido)

GET    /documentacion/espacios/:eid/listas                         listas + conteo de documentos
POST   /documentacion/espacios/:eid/listas                         crear (unicidad por espacio, 409 EXISTE_ELIMINADO)
PATCH  /documentacion/espacios/:eid/listas/orden                   reordenar (drag & drop)
PUT    /documentacion/espacios/:eid/listas/:lid                    editar
PATCH  /documentacion/espacios/:eid/listas/:lid/active|restore     activar/desactivar · reactivar
DELETE /documentacion/espacios/:eid/listas/:lid                    eliminar (409 con documentos)

GET    /documentacion/espacios/:eid/listas/:lid/documentos         documentos de la lista (livianos)
PATCH  /documentacion/espacios/:eid/listas/:lid/documentos/orden   reordenar (drag & drop)

POST   /documentacion/documentos                                   crear
GET    /documentacion/documentos/:id                               completo (cuerpo saneado + adjuntos)
PUT    /documentacion/documentos/:id                               editar (archiva la versión anterior)
PATCH  /documentacion/documentos/:id/mover                         mover de lista (exige editar AMBOS espacios)
DELETE /documentacion/documentos/:id                               eliminar (soft)
GET    /documentacion/documentos/:id/versiones                     historial
POST   /documentacion/documentos/:id/versiones/:vid/restaurar      restaurar una versión

POST   /documentacion/archivos                                     subir imagen o adjunto
GET    /documentacion/archivos/:nombre                             servir (headers defensivos)
DELETE /documentacion/archivos/:id                                 eliminar

GET|POST      /documentacion/admin/espacios                        administración (doc-espacios:*)
PUT|DELETE    /documentacion/admin/espacios/:id
PATCH         /documentacion/admin/espacios/:id/active|restore
GET|PUT       /documentacion/admin/espacios/:id/accesos            matriz eje ESPACIO
GET|PUT       /documentacion/admin/usuarios/:userId/espacios       matriz eje USUARIO
```

## Decisiones que conviene recordar

- **Un documento es texto Y/O archivos**, no una cosa o la otra: se puede subir solo un PDF, escribir solo texto, o adjuntar el PDF y explicarlo arriba. Evita duplicar documentos para agregarle una nota a un archivo.
- **Se puede adjuntar mientras se crea**, no solo al editar. Como el documento todavía no tiene id, el archivo se sube suelto (`documentoId` null) y el alta lo liga con `archivoIds` — mismo mecanismo que el modal de tareas. Al ligar se filtra por `documentoId: null`: sin eso, mandando el id de un adjunto ajeno se lo podría robar de otro documento. Si el alta se cancela, el archivo queda huérfano y lo borra el **GC diario** (`services/avisos/gc.handler.js`, 48 h de gracia, cubre tareas y documentación).
- **Una imagen puede ser adjunto O contenido**, y lo decide **cómo se sube**, no qué es. El endpoint recibe `destino`: `editor` (default, imagen pegada en el cuerpo → `tipo: 'imagen'`) o `adjunto` (botón/arrastre → `tipo: 'archivo'`, aparece en la lista). Las **defensas no cambian** entre los dos casos: firma binaria, lista blanca y el límite de 5 MB de las imágenes se aplican igual.
- **Arrastrar y soltar**: `components/shared/ZonaAdjuntos.vue`, compartido con tareas. Acepta varios archivos de una, los sube de a uno y no corta al primer error — informa cuáles entraron y cuál falló con su motivo.
- **Historial de versiones append-only** (`documento_versiones`): cada edición que cambia título o cuerpo archiva **el estado anterior** con su autor. Restaurar = escribir la vieja como actual, lo que a su vez archiva la que estaba: nunca se pierde nada.
- **El cuerpo se sanea en servidor al guardar y al servir**, con la lista blanca compartida en `services/html/sanitizador.service.js` (la misma de las descripciones de tareas: acepta imágenes de `tareas/archivos` y de `documentacion/archivos`).
- **Los binarios van a `storage/documentacion/`** (disco privado, fuera de `public/`), con las defensas comunes de `services/archivos/archivoPrivado.service.js`: tipo por firma binaria, lista blanca de extensiones, 5 MB imágenes / 15 MB adjuntos, nombre aleatorio `YYYYMM_<20hex>` y headers defensivos al servir.
- **`orden` en listas y documentos** sostiene el drag & drop; se guarda en múltiplos de 10 para poder insertar sin renumerar todo.
- **`docEspacioId` va desnormalizado en `documentos`** (además de `docListaId`) para filtrar por permisos y buscar sin joins; al mover un documento se actualizan los dos campos juntos.

## Frontend

| Pantalla | Ruta | Archivo |
|----------|------|---------|
| Home (espacios + buscador) | `/documentacion` | `views/documentacion/DocumentacionHomePage.vue` |
| Listas del espacio | `/documentacion/espacios/:eid` | `views/documentacion/DocListasPage.vue` |
| Documentos de la lista | `/documentacion/espacios/:eid/listas/:lid` | `views/documentacion/DocumentosPage.vue` |
| Ver/editar documento | `?doc=<id>` sobre la anterior | `components/documentacion/DocumentoModal.vue` |
| Administrar espacios | `/documentacion/espacios` | `views/documentacion/DocEspaciosPage.vue` |

El editor es el mismo TipTap de las tareas (`components/tareas/DescripcionEditor.vue`), que ahora recibe la función de subida por prop `subir` para poder mandar las imágenes al storage de documentación. Los archivos se sirven con auth, así que se resuelven a blobs con `useArchivosProtegidos`.
