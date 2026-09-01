/**
 * Sistema Interno — Generación del spec OpenAPI 3.
 *
 * Devuelve un documento OpenAPI 3 base (info, servidores, security, envelope de respuesta y
 * los endpoints de infra). Se sirve en /api/openapi.json y se renderiza con Scalar en
 * /api/docs. Los módulos feature extienden `paths` a medida que se construyen.
 */

/** Esquema reutilizable del envelope estándar de respuesta. */
const RESPONSE_ENVELOPE = {
    type: 'object',
    properties: {
        success: { type: 'boolean' },
        code: { type: 'integer' },
        message: { type: 'string' },
        timestamp: { type: 'string' },
        data: {},
        meta: { type: 'object' }
    }
};

/** Helper: define un path con respuesta envelope estándar. */
const op = (summary, tag, extra = {}) => ({
    summary,
    tags: [tag],
    responses: { '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Response' } } } } },
    ...extra
});

/** Shorthand de security con access token. */
const auth = { security: [{ accessToken: [] }] };

/**
 * Construye el documento OpenAPI 3 del Sistema Interno.
 * @returns {object} Documento OpenAPI 3.0.3.
 */
export const buildOpenApiSpec = () => ({
    openapi: '3.0.3',
    info: {
        title: `${process.env.APP_NAME || 'Sistema Interno'} API`,
        version: '1.0.0',
        description: 'API del Sistema Interno (single-tenant). Respuestas con envelope estándar { success, code, message, data, meta }.'
    },
    servers: [{ url: (process.env.PUBLIC_API_URL || 'http://localhost:3010/api'), description: 'API' }],
    components: {
        securitySchemes: {
            accessToken: { type: 'apiKey', in: 'header', name: 'x-access-token' }
        },
        schemas: { Response: RESPONSE_ENVELOPE }
    },
    tags: [
        { name: 'Auth', description: 'Login (password + MFA opcional), refresh, cambio de contraseña' },
        { name: 'Usuarios', description: 'ABM de usuarios del sistema' },
        { name: 'Roles', description: 'Roles y capabilities (permisos granulares)' },
        { name: 'Me', description: 'Contexto de sesión (usuario, módulos, capabilities)' },
        { name: 'Settings', description: 'Preferencias y configuración' },
        { name: 'Webhooks', description: 'Webhooks salientes firmados' },
        { name: 'Catálogos', description: 'Áreas, clientes, servicios y formas de facturación' },
        { name: 'Abonos', description: 'Abonos: precios, actualizaciones y facturación mensual' },
        { name: 'Proyectos', description: 'Proyectos y cobranzas en cuotas (USD, tope de presupuesto, auditoría)' },
        { name: 'Tareas', description: 'Tareas del equipo: espacios, listas, estados con historial, archivos' },
        { name: 'Empleados', description: 'Ficha del personal, vacaciones y archivos' },
        { name: 'Sueldos', description: 'Salarios: vigente por historial, aumentos, planificación y cuentas' },
        { name: 'Espacios', description: 'Espacios de trabajo: ABM y matriz de accesos por usuario (doble eje)' },
        { name: 'Documentación', description: 'Base de conocimiento: espacios propios, listas, documentos con versiones y adjuntos' },
        { name: 'Panel', description: 'Dashboard con bloques por capability' },
        { name: 'Mantenimiento', description: 'Monitoreo de servidores (métricas del agente, umbrales) y de sitios web (disponibilidad, dominio, certificado)' }
    ],
    paths: {
        '/auth/signin': { post: op('Login con usuario/contraseña', 'Auth') },
        '/auth/refresh': { post: op('Refrescar access token', 'Auth') },
        '/auth/change-password': { post: op('Cambiar la contraseña propia (step-up)', 'Auth', auth) },
        '/auth/mfa/login': { post: op('2do factor (TOTP/backup) tras signin con MFA', 'Auth') },
        '/auth/mfa/status': { get: op('Estado del 2FA del usuario logueado ({ mfaEnabled })', 'Auth', auth) },
        '/auth/mfa/enroll': { post: op('Iniciar enrolamiento de MFA (secreto + QR + backup codes)', 'Auth', auth) },
        '/auth/mfa/activate': { post: op('Activar MFA verificando un código TOTP', 'Auth', auth) },
        '/auth/mfa/disable': { post: op('Desactivar MFA (requiere contraseña)', 'Auth', auth) },
        '/me': { get: op('Contexto de sesión: usuario + módulos + capabilities', 'Me', auth) },
        '/users': {
            get: op('Listar usuarios (paginado, búsqueda)', 'Usuarios', auth),
            post: op('Crear usuario', 'Usuarios', auth)
        },
        '/users/{id}': {
            get: op('Un usuario por id', 'Usuarios', auth),
            put: op('Editar usuario', 'Usuarios', auth),
            delete: op('Eliminar usuario (baja lógica)', 'Usuarios', auth)
        },
        '/users/{id}/active': { patch: op('Activar/desactivar usuario', 'Usuarios', auth) },
        '/users/my-account': { get: op('La cuenta propia', 'Usuarios', auth) },
        '/users/roles': {
            get: op('Listar roles con capabilities y usuarios', 'Roles', auth),
            post: op('Crear rol + capabilities', 'Roles', auth)
        },
        '/users/roles/create': { get: op('Catálogo de capabilities agrupado por módulo', 'Roles', auth) },
        '/users/roles/{id}': {
            get: op('Un rol con sus capabilities', 'Roles', auth),
            put: op('Editar rol + capabilities', 'Roles', auth),
            delete: op('Eliminar rol (protegido: Admin / en uso)', 'Roles', auth)
        },
        '/webhooks/subscriptions': {
            get: op('Listar webhooks salientes', 'Webhooks', auth),
            post: op('Crear webhook saliente', 'Webhooks', auth)
        },
        '/abonos': {
            get: op('Listar abonos — SIN paginar: devuelve todos los del filtro para poder facturar/actualizar en masa (page y limit se ignoran). estado=vencido incluye el que vence HOY; proximo son 1..30 días', 'Abonos', auth),
            post: op('Crear abono (nace inactivo salvo indicación)', 'Abonos', auth)
        },
        '/abonos/resumen': { get: op('Tiles del listado: activos, total mensual, próximos, vencidos', 'Abonos', auth) },
        '/abonos/{id}': {
            get: op('Un abono con días de actualización calculados', 'Abonos', auth),
            put: op('Editar abono (el precio va por /actualizar)', 'Abonos', auth),
            delete: op('Eliminar abono (las facturaciones históricas se conservan)', 'Abonos', auth)
        },
        '/abonos/{id}/active': { patch: op('Activar/desactivar abono', 'Abonos', auth) },
        '/abonos/{id}/actualizaciones': { get: op('Historial de actualizaciones de precio', 'Abonos', auth) },
        '/abonos/actualizar/preview': { post: op('Preview de actualización de precios (puro)', 'Abonos', auth) },
        '/abonos/actualizar': { post: op('Aplicar actualización (idempotente por operationId)', 'Abonos', auth) },
        '/abonos/facturar/preview': { post: op('Preview de facturación del período (detecta ya facturados)', 'Abonos', auth) },
        '/abonos/facturar': { post: op('Facturar período (congela montos; idempotente)', 'Abonos', auth) },
        '/abonos/facturaciones': { get: op('Histórico de facturaciones (anuladas excluidas por default)', 'Abonos', auth) },
        '/abonos/facturaciones/{id}/anular': { post: op('Anular facturación (auditada, con motivo; re-facturable)', 'Abonos', auth) },
        '/proyectos': {
            get: op('Listar proyectos (filtro estado CSV, cerrados al final, días para entrega en SQL)', 'Proyectos', auth),
            post: op('Crear proyecto (5 fechas de ciclo de vida opcionales)', 'Proyectos', auth)
        },
        '/proyectos/grilla': { get: op('Grilla anual: proyectos × 12 meses, totales por mes y gran total', 'Proyectos', auth) },
        '/proyectos/{id}': {
            get: op('Un proyecto con cliente/servicio y días para entrega', 'Proyectos', auth),
            put: op('Editar proyecto', 'Proyectos', auth),
            delete: op('Eliminar proyecto (409 si tiene cobranzas cobradas)', 'Proyectos', auth)
        },
        '/proyectos/{id}/cobranzas': {
            get: op('Cuotas + KPIs (presupuesto/planificado/cobrado/faltantes) + auditoría', 'Proyectos', auth),
            post: op('Agregar cuota en USD (respeta el tope del presupuesto)', 'Proyectos', auth)
        },
        '/proyectos/{id}/cobranzas/mover': { patch: op('Mover cuotas PENDIENTES a otro período (batch, scoped)', 'Proyectos', auth) },
        '/proyectos/{id}/cobranzas/{cobranzaId}': { delete: op('Eliminar cuota pendiente (auditado)', 'Proyectos', auth) },
        '/proyectos/{id}/cobranzas/{cobranzaId}/monto': { patch: op('Editar monto USD de una cuota pendiente', 'Proyectos', auth) },
        '/proyectos/{id}/cobranzas/{cobranzaId}/cobrar': { post: op('Cobrar con el peso REAL: cotización derivada y montos congelados', 'Proyectos', auth) },
        '/proyectos/{id}/cobranzas/{cobranzaId}/descobrar': { post: op('Descobrar (vuelve a pendiente; el cobro queda en la auditoría)', 'Proyectos', auth) },
        '/espacios': {
            get: op('Listado de administración: conteos + resumen de accesos', 'Espacios', auth),
            post: op('Crear espacio (el creador queda con acceso total)', 'Espacios', auth)
        },
        '/espacios/{id}': {
            get: op('Un espacio', 'Espacios', auth),
            put: op('Editar espacio', 'Espacios', auth),
            delete: op('Eliminar espacio (409 con listas o tareas)', 'Espacios', auth)
        },
        '/espacios/{id}/active': { patch: op('Activar/desactivar espacio', 'Espacios', auth) },
        '/espacios/{id}/restore': { patch: op('Reactivar espacio eliminado', 'Espacios', auth) },
        '/espacios/{id}/usuarios': {
            get: op('Matriz de accesos del EJE ESPACIO (admins informativos, por rol)', 'Espacios', auth),
            put: op('Guardar matriz eje espacio (solo gestionables; editar⇒ver)', 'Espacios', auth)
        },
        '/espacios/usuario/{userId}': {
            get: op('Matriz de accesos del EJE USUARIO', 'Espacios', auth),
            put: op('Guardar matriz eje usuario (reemplaza SOLO sus filas; admin → 403)', 'Espacios', auth)
        },
        '/tareas/espacios': { get: op('Home del módulo: espacios visibles + mi resumen (fuente única)', 'Tareas', auth) },
        '/tareas/asignables': { get: op('Usuarios que pueden recibir tareas y ser mencionados (id, nombre, username)', 'Tareas', auth) },
        '/tareas/resumen': { get: op('Resumen por categorías (f=pendientes|hoy|por_vencer|vencidas; u=todos|sin|id; e=ids de espacio separados por coma)', 'Tareas', auth) },
        '/tareas/espacios/{eid}/listas/{lid}/orden': { patch: op('Orden manual de las tareas abiertas de la lista (arrastrar y soltar; ids en el orden nuevo)', 'Tareas', auth) },
        '/tareas/lote/estado': { patch: op('Cambia el estado de varias tareas (ids + estado)', 'Tareas', auth) },
        '/tareas/lote/mover': { patch: op('Mueve varias tareas a otra lista (ids + listaId)', 'Tareas', auth) },
        '/tareas/lote/eliminar': { post: op('Elimina varias tareas (ids en el body; POST porque un DELETE con cuerpo se pierde en los proxies)', 'Tareas', auth) },
        '/tareas/analisis': { get: op('Análisis de tareas (capability tareas:analisis, NO tareas:read): equipo, por lista, por espacio, realizadas en un rango (desde/hasta, default mes actual; agregados por persona y carga por lista —pendientes + cerradas—, sin el detalle tarea por tarea), serie anual (anio), antigüedad/estancadas (estancadas=días) y prioridad. Filtro e=ids de espacio separados por coma', 'Tareas', auth) },
        '/tareas/espacios/{eid}/listas': {
            get: op('Listas del espacio con agregados (requiere VER el espacio)', 'Tareas', auth),
            post: op('Crear lista (requiere EDITAR el espacio; unicidad por espacio + reactivación)', 'Tareas', auth)
        },
        '/tareas/espacios/{eid}/listas/{lid}': {
            put: op('Editar lista', 'Tareas', auth),
            delete: op('Eliminar lista (409 con tareas)', 'Tareas', auth)
        },
        '/tareas/espacios/{eid}/listas/{lid}/active': { patch: op('Activar/desactivar lista', 'Tareas', auth) },
        '/tareas/espacios/{eid}/listas/{lid}/restore': { patch: op('Reactivar lista eliminada', 'Tareas', auth) },
        '/tareas/espacios/{eid}/listas/{lid}/tareas': { get: op('Listado central con los 14 filtros del legado (query string)', 'Tareas', auth) },
        '/tareas': { post: op('Crear tarea (valida asignable + capa espacio; HTML saneado)', 'Tareas', auth) },
        '/tareas/{id}': {
            get: op('Detalle: historial + tiempo trabajado + adjuntos (saneado al servir)', 'Tareas', auth),
            put: op('Edición COMPLETA (todos los campos; estado → bitácora)', 'Tareas', auth),
            delete: op('Eliminar tarea (404 real si no existe)', 'Tareas', auth)
        },
        '/tareas/{id}/rapida': { patch: op('Edición RÁPIDA: nombre/asignado/vencimiento/prioridad — NO toca descripción ni estado', 'Tareas', auth) },
        '/tareas/{id}/estado': { patch: op('Cambio de estado (inválido → 422; bitácora solo si cambió)', 'Tareas', auth) },
        '/tareas/{id}/mover': { patch: op('Mover a otra lista/espacio (mejora; exige editar AMBOS espacios)', 'Tareas', auth) },
        // Clonar CREA (tareas:create), no edita: duplicar no es modificar el original.
        '/tareas/{id}/clonar': { post: op('Duplicar la tarea (estado en abierta, adjuntos copiados; body opcional: listaId, nombre)', 'Tareas', auth) },
        '/tareas/espacios/{eid}/listas/{lid}/clonar': { post: op('Duplicar la lista con todas sus tareas (body opcional: nombre, conTareas)', 'Tareas', auth) },
        '/tareas/archivos': { post: op('Subir imagen (5 MB, firma binaria) o adjunto (15 MB, lista blanca)', 'Tareas', auth) },
        '/tareas/archivos/{nombre}': { get: op('Servir archivo (headers defensivos; nombre aleatorio validado)', 'Tareas', auth) },
        '/tareas/archivos/{id}': { delete: op('Eliminar adjunto', 'Tareas', auth) },
        '/documentacion/espacios': { get: op('Home: espacios de documentación visibles con conteos (capa 2 por usuario)', 'Documentación', auth) },
        '/documentacion/buscar': { get: op('Buscar por título y contenido (?q, min 2 chars) en los espacios visibles', 'Documentación', auth) },
        '/documentacion/espacios/{eid}/listas': {
            get: op('Listas del espacio con conteo de documentos (requiere VER el espacio)', 'Documentación', auth),
            post: op('Crear lista (requiere EDITAR; unicidad por espacio + reactivación)', 'Documentación', auth)
        },
        '/documentacion/espacios/{eid}/listas/orden': { patch: op('Reordenar listas (drag & drop; ids en el orden deseado)', 'Documentación', auth) },
        '/documentacion/espacios/{eid}/listas/{lid}': {
            put: op('Editar lista (título/descripción)', 'Documentación', auth),
            delete: op('Eliminar lista (409 si tiene documentos)', 'Documentación', auth)
        },
        '/documentacion/espacios/{eid}/listas/{lid}/active': { patch: op('Activar/desactivar lista', 'Documentación', auth) },
        '/documentacion/espacios/{eid}/listas/{lid}/restore': { patch: op('Reactivar lista eliminada', 'Documentación', auth) },
        '/documentacion/espacios/{eid}/listas/{lid}/documentos': { get: op('Documentos de la lista (livianos, con extracto y adjuntos)', 'Documentación', auth) },
        '/documentacion/espacios/{eid}/listas/{lid}/documentos/orden': { patch: op('Reordenar documentos (drag & drop)', 'Documentación', auth) },
        '/documentacion/documentos': { post: op('Crear documento (título + HTML saneado; adjuntos aparte)', 'Documentación', auth) },
        '/documentacion/documentos/{id}': {
            get: op('Documento completo (cuerpo saneado al servir + adjuntos)', 'Documentación', auth),
            put: op('Editar (si cambia título o cuerpo, archiva la versión anterior)', 'Documentación', auth),
            delete: op('Eliminar documento (soft; sus versiones quedan)', 'Documentación', auth)
        },
        '/documentacion/documentos/{id}/mover': { patch: op('Mover a otra lista (exige editar AMBOS espacios)', 'Documentación', auth) },
        '/documentacion/documentos/{id}/versiones': { get: op('Historial de versiones (append-only, más nuevas primero)', 'Documentación', auth) },
        '/documentacion/documentos/{id}/versiones/{vid}/restaurar': { post: op('Restaurar una versión (la actual se archiva)', 'Documentación', auth) },
        '/documentacion/archivos': { post: op('Subir imagen (5 MB) o adjunto (15 MB) — mismas defensas que tareas', 'Documentación', auth) },
        '/documentacion/archivos/{nombre}': { get: op('Servir archivo (headers defensivos; nombre aleatorio validado)', 'Documentación', auth) },
        '/documentacion/archivos/{id}': { delete: op('Eliminar archivo', 'Documentación', auth) },
        '/documentacion/admin/espacios': {
            get: op('Administración: todos los espacios con accesos (doc-espacios:read)', 'Documentación', auth),
            post: op('Crear espacio (el creador queda con acceso total)', 'Documentación', auth)
        },
        '/documentacion/admin/espacios/{id}': {
            put: op('Editar espacio', 'Documentación', auth),
            delete: op('Eliminar espacio (409 si tiene listas o documentos)', 'Documentación', auth)
        },
        '/documentacion/admin/espacios/{id}/active': { patch: op('Activar/desactivar espacio', 'Documentación', auth) },
        '/documentacion/admin/espacios/{id}/restore': { patch: op('Reactivar espacio eliminado', 'Documentación', auth) },
        '/documentacion/admin/espacios/{id}/accesos': {
            get: op('Matriz del eje ESPACIO (usuarios con ver/editar)', 'Documentación', auth),
            put: op('Guardar matriz del eje ESPACIO (editar⇒ver; admins intocables)', 'Documentación', auth)
        },
        '/documentacion/admin/usuarios/{userId}/espacios': {
            get: op('Matriz del eje USUARIO (espacios de documentación)', 'Documentación', auth),
            put: op('Guardar matriz del eje USUARIO', 'Documentación', auth)
        },
        '/empleados': {
            get: op('Listado con áreas y vacaciones por lote (bloques según capabilities)', 'Empleados', auth),
            post: op('Alta de ficha (el sueldo se carga desde Sueldos)', 'Empleados', auth)
        },
        '/empleados/{id}': {
            get: op('Ficha completa: datos + vacaciones (motor del legado) + archivos', 'Empleados', auth),
            put: op('Editar ficha (áreas se reemplazan completas)', 'Empleados', auth),
            delete: op('Eliminar (409 con sueldos, pagos o archivos — mejora)', 'Empleados', auth)
        },
        '/empleados/{id}/active': { patch: op('Activar/desactivar empleado', 'Empleados', auth) },
        '/empleados/{id}/vacaciones/tomas': { post: op('Registrar período (días corridos; valida disponibilidad y solapamiento)', 'Empleados', auth) },
        '/empleados/{id}/vacaciones/tomas/{tomaId}': { delete: op('Eliminar período', 'Empleados', auth) },
        '/empleados/{id}/vacaciones/asignacion': { put: op('Override de días para un año (dias null = quitar)', 'Empleados', auth) },
        '/empleados/{id}/archivos': { post: op('Subir archivo a la ficha (15 MB, whitelist + firma)', 'Empleados', auth) },
        '/empleados/archivos/{archivoId}': { get: op('Descargar (attachment + nosniff, anti-traversal)', 'Empleados', auth) },
        '/empleados/{id}/archivos/{archivoId}': { delete: op('Eliminar archivo', 'Empleados', auth) },
        '/sueldos': { get: op('Listado: vigente por historial (salarioEnMes), último cambio, futuros, masa salarial', 'Sueldos', auth) },
        '/sueldos/{empleadoId}': { put: op('Edición inline (registra contra el VIGENTE; solo activos)', 'Sueldos', auth) },
        '/sueldos/{empleadoId}/historial': { get: op('Historial con tipos (Carga inicial / Ajuste % / Edición manual) y variación', 'Sueldos', auth) },
        '/sueldos/actualizar/preview': { post: op('Preview de actualización por % (global + overrides por fila)', 'Sueldos', auth) },
        '/sueldos/actualizar': { post: op('Aplicar actualización por %', 'Sueldos', auth) },
        '/sueldos/aumentos/preview': { post: op('Preview de aumentos multi-mes: matriz + registros que se PISAN', 'Sueldos', auth) },
        '/sueldos/aumentos': { post: op('Aplicar aumentos (trx secuencial; % sobre mes base, no encadenados)', 'Sueldos', auth) },
        '/sueldos/planificacion': {
            get: op('Matriz empleado × cuenta del período (default: mes anterior)', 'Sueldos', auth),
            put: op('Guardar matriz (fechaPago se conserva; monto 0 borra la celda)', 'Sueldos', auth)
        },
        '/sueldos/cuentas': {
            get: op('Cuentas de pago con usos', 'Sueldos', auth),
            post: op('Crear cuenta', 'Sueldos', auth)
        },
        '/sueldos/cuentas/{id}': {
            put: op('Editar cuenta', 'Sueldos', auth),
            delete: op('Eliminar cuenta (409 con pagos — mejora)', 'Sueldos', auth)
        },
        '/sueldos/cuentas/{id}/active': { patch: op('Activar/desactivar cuenta', 'Sueldos', auth) },
        '/sueldos/cuentas/{id}/restore': { patch: op('Reactivar cuenta eliminada', 'Sueldos', auth) },
        '/app-config': {
            get: op('Configuración de negocio (cotización, redondeo, avisos)', 'Settings', auth),
            put: op('Actualizar una clave de configuración (validada)', 'Settings', auth)
        },
        '/dashboard': { get: op('Bloques del panel según capabilities: cotización, abonos, facturación del mes, proyectos y tareas del equipo', 'Panel', auth) },
        '/dashboard/estadisticas': { get: op('Estadísticas anuales de facturación (?anio): mensual abonos vs proyectos, por servicio top-7+Otros, por área. Requiere estadisticas:read', 'Panel', auth) },
        '/mantenimiento/servidores': {
            get: op('Inventario de servidores con su última métrica e incidentes abiertos', 'Mantenimiento', auth),
            post: op('Alta de servidor (devuelve el token del agente UNA sola vez)', 'Mantenimiento', auth)
        },
        '/mantenimiento/servidores/{id}': {
            get: op('Ficha: métricas actuales, series (fina y diaria) e incidentes', 'Mantenimiento', auth),
            put: op('Editar servidor (umbrales propios y qué alertas crea: alertaOffline/Cpu/Ram/Disco)', 'Mantenimiento', auth),
            delete: op('Eliminar servidor (baja lógica; borra su historial)', 'Mantenimiento', auth)
        },
        '/mantenimiento/servidores/{id}/token': { post: op('Regenerar el token del agente (invalida el anterior)', 'Mantenimiento', auth) },
        '/mantenimiento/servidores/{id}/active': { patch: op('Activar/desactivar el monitoreo del servidor', 'Mantenimiento', auth) },
        '/mantenimiento/sitios': {
            get: op('Sitios web con estado, vencimiento de dominio y de certificado', 'Mantenimiento', auth),
            post: op('Alta de sitio (verificaMarcador=false para sitios de terceros)', 'Mantenimiento', auth)
        },
        '/mantenimiento/sitios/{id}': {
            get: op('Ficha del sitio: disponibilidad, últimos chequeos e incidentes', 'Mantenimiento', auth),
            put: op('Editar sitio (cargar dominioVenceAt a mano desactiva el refresco por RDAP)', 'Mantenimiento', auth),
            delete: op('Eliminar sitio (baja lógica; cierra sus incidentes)', 'Mantenimiento', auth)
        },
        '/mantenimiento/sitios/{id}/chequear': { post: op('Chequeo manual de disponibilidad (no abre ni cierra incidentes)', 'Mantenimiento', auth) },
        '/mantenimiento/sitios/{id}/dominio': { post: op('Consultar por RDAP el vencimiento del dominio', 'Mantenimiento', auth) },
        '/mantenimiento/sitios/{id}/active': { patch: op('Activar/desactivar el monitoreo del sitio', 'Mantenimiento', auth) },
        // Vistas: las URLs concretas que se chequean dentro de un sitio (`/`, `/ecommerce`…).
        // Cada una con su propio «lo administramos nosotros» y su override del marcador.
        '/mantenimiento/sitios/{id}/vistas': {
            get: op('Vistas que se chequean del sitio', 'Mantenimiento', auth),
            post: op('Agregar una vista al sitio', 'Mantenimiento', auth),
        },
        '/mantenimiento/sitios/{id}/vistas/orden': { put: op('Reordenar las vistas del sitio', 'Mantenimiento', auth) },
        '/mantenimiento/sitios/vistas/{id}': {
            put: op('Editar una vista', 'Mantenimiento', auth),
            delete: op('Eliminar una vista (la última del sitio → 409)', 'Mantenimiento', auth),
        },
        '/mantenimiento/sitios/vistas/{id}/active': { patch: op('Activar/desactivar el chequeo de una vista', 'Mantenimiento', auth) },
        '/mantenimiento/sitios/{id}/velocidad': { get: op('Serie de velocidad por hora, día, mes o año (query: granularidad, vistaId)', 'Mantenimiento', auth) },
        '/agente/metricas': { post: op('Reporte del agente (auth por header x-agent-token, SIN sesión): cpu, ram, disco, discos[]', 'Mantenimiento') },
        '/health': { get: op('Salud del backend y su base (público, sin sesión): lo consulta el watchdog externo', 'Mantenimiento') },
        '/agente/instalar-agente.sh': { get: op('Instalador del agente (público, sin secretos)', 'Mantenimiento') },
        '/notificaciones': { get: op('Mis notificaciones (+ conteo de no leídas) — personales, sin capability', 'Me', auth) },
        '/notificaciones/leidas': { patch: op('Marcar mis notificaciones como leídas (todas o ids)', 'Me', auth) },
        '/app-config/cotizaciones': { get: op('Histórico de la cotización del dólar (mejora §10.10)', 'Settings', auth) },
        '/tareas/{id}/comentarios': { post: op('Comentar una tarea (menciones @username notifican; requiere VER el espacio)', 'Tareas', auth) },
        '/tareas/comentarios/{id}': { delete: op('Eliminar comentario (autor o admin)', 'Tareas', auth) },
        // Catálogos (Fase 1): los cuatro comparten el mismo contrato REST.
        ...Object.fromEntries(['areas', 'clientes', 'servicios', 'formas-facturacion'].flatMap((key) => [
            [`/${key}`, {
                get: op(`Listar ${key} (paginado, búsqueda, filtro activo)`, 'Catálogos', auth),
                post: op(`Crear en ${key} (409 EXISTE_ELIMINADO si hay un homónimo eliminado)`, 'Catálogos', auth)
            }],
            [`/${key}/{id}`, {
                get: op(`Un registro de ${key}`, 'Catálogos', auth),
                put: op(`Editar en ${key}`, 'Catálogos', auth),
                delete: op(`Eliminar de ${key} (409 si está en uso)`, 'Catálogos', auth)
            }],
            [`/${key}/{id}/active`, { patch: op(`Activar/desactivar en ${key}`, 'Catálogos', auth) }],
            [`/${key}/{id}/restore`, { patch: op(`Reactivar un eliminado de ${key}`, 'Catálogos', auth) }]
        ]))
    }
});
