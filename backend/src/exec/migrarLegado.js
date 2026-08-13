/**
 * Sistema Interno — Migración de datos del sistema legado (PHP) a la base nueva.
 *
 * Copia TODO el contenido de negocio del sistema PHP (28 tablas con datos) a la base del
 * Sistema Interno, PRESERVANDO LOS IDs originales: así todas las referencias cruzadas
 * (abonos↔facturaciones, proyectos↔cobranzas, tareas↔espacios, empleados↔sueldos) quedan
 * idénticas y cualquier planilla o link viejo sigue apuntando al mismo registro.
 *
 * ⚠️ DESTRUCTIVO: vacía las tablas de negocio de la base destino antes de copiar (incluidos
 * los seeds y el usuario admin). Por eso exige confirmación explícita. Es re-ejecutable:
 * correrlo dos veces deja el mismo resultado (útil para repetirlo el día del deploy con un
 * dump fresco).
 *
 * Uso:
 *   1. Cargar el dump del legado en una base APARTE (nunca sobre la base nueva: el dump
 *      trae DROP TABLE y se llama igual):
 *        mysql -u<user> -p -e "CREATE DATABASE IF NOT EXISTS legado_php CHARACTER SET utf8mb4"
 *        mysql -u<user> -p legado_php < sistema_interno.sql
 *   2. npm run migrar_legado -- --confirmar
 *
 * Entorno (opcional, por defecto reusa las credenciales DB_* de la base nueva):
 *   LEGACY_DB_NAME (default legado_php) · LEGACY_DB_HOST · LEGACY_DB_PORT
 *   LEGACY_DB_USER · LEGACY_DB_PASS
 *
 * Qué NO migra (y por qué):
 *   - `intentos_login` → bitácora de seguridad del legado, indexada por email; el sistema
 *     nuevo la lleva por username. Empezar limpio no pierde nada de negocio.
 *   - `cobranza_eventos` → la bitácora de cobranzas nace con el sistema nuevo (no existe
 *     en el legado): inventar eventos pasados sería auditoría falsa.
 *   - Los BINARIOS de `empleado_archivos`: se copian los registros, pero los archivos
 *     físicos hay que moverlos a mano a `storage/empleados/<id>/` (el script avisa).
 */

import 'dotenv/config';
import { Sequelize, QueryTypes } from 'sequelize';
import { db, initDatabase } from '../database.js';

const DB_NAME = process.env.DB_NAME || process.env.MASTER_DBNAME || 'sistema_interno';
const LEGACY_NAME = process.env.LEGACY_DB_NAME || 'legado_php';

const CONFIRMADO = process.argv.includes('--confirmar') || process.env.MIGRAR_LEGADO_CONFIRMAR === 'true';

/** Marca de tiempo para las filas del legado que no traen fecha propia. */
const AHORA = new Date().toISOString().slice(0, 19).replace('T', ' ');

/**
 * Traduce el par `eliminado`/`eliminado_at` del legado al `deletedAt` (paranoid) del nuevo.
 * @param {object} r - Fila del legado.
 * @returns {string|null} Fecha de borrado lógico, o null si está viva.
 */
const borrado = (r) => (Number(r.eliminado) === 1 ? (r.eliminado_at || r.created_at || AHORA) : null);

/**
 * createdAt/updatedAt del nuevo a partir del `created_at` del legado (que no tiene updated_at).
 * @param {object} r - Fila del legado.
 * @returns {{createdAt: string, updatedAt: string}} Timestamps.
 */
const fechas = (r) => ({ createdAt: r.created_at || AHORA, updatedAt: r.updated_at || r.created_at || AHORA });

/**
 * Slug ASCII en minúsculas (para nombres de rol y usernames).
 * @param {string} texto - Texto original.
 * @param {string} [separador] - Separador de palabras.
 * @returns {string} Slug.
 */
const slug = (texto, separador = '-') => String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // saca tildes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separador)
    // Recorta separadores de los extremos por clase de caracteres: interpolar el separador
    // en la RegExp lo trataría como metacarácter (con "." el patrón `^.+` borraba todo).
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');

/**
 * Parte el nombre completo del legado en nombre + apellido (el nuevo los guarda separados).
 * @param {string} completo - Nombre completo.
 * @returns {{name: string, lastName: string}} Partes.
 */
const partirNombre = (completo) => {
    const partes = String(completo || '').trim().split(/\s+/).filter(Boolean);
    return { name: partes[0] || 'Usuario', lastName: partes.slice(1).join(' ') || '' };
};

/**
 * Mapa de permisos: sección del legado (con sus flags ver/editar) → capabilities del nuevo.
 * El legado tenía permisos de GRANO GRUESO (ver/editar por sección); el nuevo los tiene
 * granulares (`modulo:accion`), así que "editar" se expande al set completo de acciones
 * de escritura de esa sección. Deny-by-default: lo que no está acá, no se otorga.
 */
const SECCION_CAPS = {
    dashboard: { ver: ['dashboard:read'], editar: [] },
    clientes: { ver: ['clientes:read'], editar: ['clientes:create', 'clientes:update', 'clientes:toggle', 'clientes:delete'] },
    empleados: {
        ver: ['empleados:read', 'vacaciones:read', 'empleados-archivos:read'],
        editar: ['empleados:create', 'empleados:update', 'empleados:toggle', 'empleados:delete', 'vacaciones:manage', 'empleados-archivos:upload', 'empleados-archivos:delete'],
    },
    servicios: { ver: ['servicios:read'], editar: ['servicios:create', 'servicios:update', 'servicios:toggle', 'servicios:delete'] },
    areas: { ver: ['areas:read'], editar: ['areas:create', 'areas:update', 'areas:toggle', 'areas:delete'] },
    abonos: {
        ver: ['abonos:read', 'facturaciones:read'],
        editar: ['abonos:create', 'abonos:update', 'abonos:toggle', 'abonos:delete', 'abonos:actualizar-precio', 'abonos:facturar', 'facturaciones:anular'],
    },
    tareas: { ver: ['tareas:read'], editar: ['tareas:create', 'tareas:update', 'tareas:delete', 'tareas:estado', 'tareas:asignar'] },
    // En el legado la sección "facturacion" es el ABM de FORMAS de facturación.
    facturacion: { ver: ['formas-facturacion:read'], editar: ['formas-facturacion:create', 'formas-facturacion:update', 'formas-facturacion:toggle', 'formas-facturacion:delete'] },
    proyectos: { ver: ['proyectos:read'], editar: ['proyectos:create', 'proyectos:update', 'proyectos:delete'] },
    cobranzas: { ver: ['cobranzas:read'], editar: ['cobranzas:create', 'cobranzas:update', 'cobranzas:mover', 'cobranzas:cobrar', 'cobranzas:descobrar', 'cobranzas:delete'] },
    sueldos: { ver: ['sueldos:read', 'sueldos:historial'], editar: ['sueldos:update', 'sueldos:actualizar'] },
    aumentos: { ver: ['aumentos:read'], editar: ['aumentos:manage'] },
    planificacion: { ver: ['planificacion:read'], editar: ['planificacion:manage'] },
    cuentas: { ver: ['cuentas:read'], editar: ['cuentas:create', 'cuentas:update', 'cuentas:toggle', 'cuentas:delete'] },
    usuarios: { ver: ['usuarios:read'], editar: ['usuarios:create', 'usuarios:update', 'usuarios:toggle', 'usuarios:delete'] },
    roles: { ver: ['roles:read'], editar: ['roles:create', 'roles:update', 'roles:delete'] },
    configuracion: { ver: ['configuracion:read'], editar: ['configuracion:update'] },
    espacios: { ver: ['espacios:read'], editar: ['espacios:create', 'espacios:update', 'espacios:toggle', 'espacios:delete', 'espacios:asignar-usuarios'] },
    // Sección desactivada en el legado; en el nuevo los gráficos viven en el panel.
    estadistica_areas: { ver: ['dashboard:read'], editar: [] },
};

/** Permisos especiales del legado → capability del nuevo (la tabla suele estar vacía). */
const PERMISOS_ESPECIALES = {
    actualizar_precios: 'abonos:actualizar-precio',
    facturar: 'abonos:facturar',
    asignar_tareas: 'tareas:asignar',
    anular_facturacion: 'facturaciones:anular',
};

/** Claves de `configuracion` del legado → nombres de `configs` del nuevo. */
const CONFIG_KEYS = {
    cotizacion_dolar: 'COTIZACION_DOLAR',
    tareas_dias_por_vencer: 'TAREAS_DIAS_POR_VENCER',
    redondeo_abonos: 'REDONDEO_ABONOS',
};

/**
 * Tablas destino a vaciar, en orden hijo → padre (respeta las FKs sin desactivarlas).
 * Se usa DELETE y no TRUNCATE a propósito: TRUNCATE es DDL y haría COMMIT implícito,
 * rompiendo el todo-o-nada de la transacción.
 */
const TABLAS_A_VACIAR = [
    'cobranza_eventos', 'cobranzas', 'facturaciones', 'abono_actualizaciones', 'abonos', 'proyectos',
    'cuenta_disponibles', 'sueldo_pagos', 'sueldo_actualizaciones',
    'vacacion_tomas', 'vacacion_asignaciones', 'empleado_areas', 'empleado_archivos', 'empleados',
    'tarea_comentarios', 'tarea_archivos', 'tarea_estados', 'tareas', 'listas', 'usuario_espacios',
    'notificaciones', 'userSettings', 'embedding_items', 'login_attempts', 'cotizacion_dolar',
    'users', 'role_capabilities', 'roles',
    'espacios_trabajo', 'cuentas_pago', 'formas_facturacions', 'servicios', 'clientes', 'areas',
];

/** Tablas cuyo AUTO_INCREMENT hay que reponer tras copiar con IDs explícitos. */
const TABLAS_AUTOINC = [
    'areas', 'clientes', 'servicios', 'formas_facturacions', 'cuentas_pago', 'espacios_trabajo',
    'roles', 'role_capabilities', 'users', 'usuario_espacios', 'listas', 'tareas', 'tarea_estados',
    'empleados', 'empleado_areas', 'empleado_archivos', 'vacacion_asignaciones', 'vacacion_tomas',
    'sueldo_actualizaciones', 'sueldo_pagos', 'cuenta_disponibles',
    'abonos', 'abono_actualizaciones', 'facturaciones', 'proyectos', 'cobranzas',
];

/** Resumen de filas copiadas por tabla (se imprime al final). */
const resumen = [];
/** Avisos no fatales (datos que requieren atención manual). */
const avisos = [];

/**
 * Parte un array en trozos de tamaño fijo (para INSERTs multi-fila acotados).
 * @param {Array} arr - Array a partir.
 * @param {number} n - Tamaño de cada trozo.
 * @returns {Array<Array>} Trozos.
 */
const enTrozos = (arr, n) => {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
};

/**
 * Inserta filas en la base nueva con columnas explícitas (incluye el id del legado).
 * @param {string} tabla - Tabla destino.
 * @param {Array<object>} filas - Filas ya mapeadas al schema nuevo (todas con las mismas claves).
 * @param {import('sequelize').Transaction} trx - Transacción.
 * @returns {Promise<number>} Cantidad insertada.
 */
const insertar = async (tabla, filas, trx) => {
    if (!filas.length) {
        resumen.push({ tabla, filas: 0 });
        return 0;
    }
    const cols = Object.keys(filas[0]);
    const lista = cols.map((c) => `\`${c}\``).join(', ');
    for (const trozo of enTrozos(filas, 200)) {
        const placeholders = trozo.map(() => `(${cols.map(() => '?').join(', ')})`).join(', ');
        const valores = trozo.flatMap((f) => cols.map((c) => (f[c] === undefined ? null : f[c])));
        await db.query(`INSERT INTO \`${tabla}\` (${lista}) VALUES ${placeholders}`, {
            replacements: valores,
            transaction: trx,
        });
    }
    resumen.push({ tabla, filas: filas.length });
    return filas.length;
};

/**
 * Punto de entrada: valida, vacía el destino y copia todo dentro de una transacción.
 * @returns {Promise<void>}
 */
const main = async () => {
    if (LEGACY_NAME === DB_NAME) {
        throw new Error(`LEGACY_DB_NAME y DB_NAME son la misma base ("${DB_NAME}"). Cargá el dump del legado en una base aparte.`);
    }

    await initDatabase();

    // Zona horaria de la conexión de la app (la fija database.js desde TIMEZONE). El legado
    // guarda las fechas de alta en columnas TIMESTAMP —que MariaDB convierte según la zona de
    // la sesión— y el sistema nuevo usa DATETIME, que es "sin zona". Leer el legado con OTRA
    // zona correría todas las fechas de alta (con UTC quedaban 3 horas adelantadas), así que
    // la conexión al legado usa exactamente la misma que la app.
    const [{ tz }] = await db.query('SELECT @@session.time_zone AS tz', { type: QueryTypes.SELECT });

    // Conexión de solo lectura al legado. `dateStrings` devuelve las fechas como texto, sin
    // pasar por objetos Date: así se copian tal cual, sin reinterpretaciones del driver.
    const legado = new Sequelize(LEGACY_NAME, process.env.LEGACY_DB_USER || process.env.DB_USER, process.env.LEGACY_DB_PASS || process.env.DB_PASS, {
        host: process.env.LEGACY_DB_HOST || process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.LEGACY_DB_PORT || process.env.DB_PORT || '3306', 10),
        dialect: process.env.DBDRIVER || 'mariadb',
        timezone: tz && tz !== 'SYSTEM' ? tz : '+00:00',
        logging: false,
        dialectOptions: { charset: 'utf8mb4', dateStrings: true },
    });
    await legado.authenticate();

    /**
     * Lee una tabla completa del legado.
     * @param {string} tabla - Tabla del legado.
     * @returns {Promise<Array<object>>} Filas.
     */
    const leer = (tabla) => legado.query(`SELECT * FROM \`${tabla}\` ORDER BY id`, { type: QueryTypes.SELECT });

    // ── Fotos previas para el informe y la confirmación ──────────────────────────────
    const [{ total: aBorrar }] = await db.query(
        'SELECT (SELECT COUNT(*) FROM users) + (SELECT COUNT(*) FROM clientes) + (SELECT COUNT(*) FROM abonos) AS total',
        { type: QueryTypes.SELECT },
    );

    if (!CONFIRMADO) {
        console.log(`\n⚠️  Esto BORRA los datos de negocio de "${DB_NAME}" (hoy: ${aBorrar} filas entre usuarios/clientes/abonos)`);
        console.log(`   y los reemplaza por los de "${LEGACY_NAME}", preservando los IDs del legado.`);
        console.log('   Volvé a correrlo con --confirmar para ejecutarlo.\n');
        await legado.close();
        await db.close();
        return;
    }

    const trx = await db.transaction();
    try {
        // ── 1. Vaciar el destino ─────────────────────────────────────────────────────
        for (const tabla of TABLAS_A_VACIAR) {
            await db.query(`DELETE FROM \`${tabla}\``, { transaction: trx });
        }
        console.log('🧹 Tablas de negocio vaciadas (incluye seeds y usuario admin)');

        // ── 2. Catálogos (sin dependencias) ──────────────────────────────────────────
        await insertar('areas', (await leer('areas')).map((r) => ({
            id: r.id, nombre: r.nombre, descripcion: r.descripcion, orden: r.orden,
            activo: r.activa, ...fechas(r), deletedAt: borrado(r),
        })), trx);

        await insertar('clientes', (await leer('clientes')).map((r) => ({
            id: r.id, nombre: r.nombre, contacto: r.contacto, email: r.email, telefono: r.telefono,
            observaciones: r.observaciones, activo: r.activo, ...fechas(r), deletedAt: borrado(r),
        })), trx);

        await insertar('servicios', (await leer('servicios')).map((r) => ({
            id: r.id, nombre: r.nombre, descripcion: r.descripcion, areaId: r.area_id,
            activo: r.activo, ...fechas(r), deletedAt: borrado(r),
        })), trx);

        await insertar('formas_facturacions', (await leer('formas_facturacion')).map((r) => ({
            id: r.id, nombre: r.nombre, activo: r.activo, ...fechas(r), deletedAt: borrado(r),
        })), trx);

        await insertar('cuentas_pago', (await leer('cuentas_pago')).map((r) => ({
            id: r.id, nombre: r.nombre, orden: r.orden, activo: r.activo, ...fechas(r), deletedAt: borrado(r),
        })), trx);

        // El nuevo no tiene `orden` en espacios (se listan alfabéticamente): se pierde a propósito.
        await insertar('espacios_trabajo', (await leer('espacios_trabajo')).map((r) => ({
            id: r.id, nombre: r.nombre, descripcion: r.descripcion, activo: r.activo,
            ...fechas(r), deletedAt: borrado(r),
        })), trx);

        // ── 3. Roles y capabilities ──────────────────────────────────────────────────
        const rolesLegado = await leer('roles');
        await insertar('roles', rolesLegado.map((r) => ({
            id: r.id,
            // El rol admin del legado se convierte en el rol de sistema del nuevo (isSystem +
            // capability `*`): no se edita ni se elimina, y el comodín no es asignable a otros.
            label: Number(r.es_admin) === 1 ? 'Administrador' : r.nombre,
            name: Number(r.es_admin) === 1 ? 'administrador' : slug(r.nombre),
            description: r.descripcion,
            isSystem: Number(r.es_admin) === 1 ? 1 : 0,
            ...fechas(r), deletedAt: borrado(r),
        })), trx);

        const permisos = await legado.query('SELECT * FROM rol_permisos', { type: QueryTypes.SELECT });
        const especiales = await legado.query('SELECT * FROM rol_permisos_especiales', { type: QueryTypes.SELECT });
        const capsPorRol = new Map();
        /**
         * Agrega una capability al set de un rol.
         * @param {number} rolId - Rol destino.
         * @param {string} cap - Capability.
         * @returns {void}
         */
        const agregarCap = (rolId, cap) => {
            if (!capsPorRol.has(rolId)) capsPorRol.set(rolId, new Set());
            capsPorRol.get(rolId).add(cap);
        };

        for (const rol of rolesLegado) {
            if (Number(rol.es_admin) === 1) agregarCap(rol.id, '*'); // comodín: acceso total
        }
        for (const p of permisos) {
            const mapa = SECCION_CAPS[p.seccion];
            if (!mapa) { avisos.push(`Sección desconocida en rol_permisos: "${p.seccion}" (sin capabilities)`); continue; }
            if (Number(p.puede_ver) === 1) mapa.ver.forEach((c) => agregarCap(p.rol_id, c));
            if (Number(p.puede_editar) === 1) {
                mapa.ver.forEach((c) => agregarCap(p.rol_id, c)); // editar implica ver
                mapa.editar.forEach((c) => agregarCap(p.rol_id, c));
            }
        }
        for (const e of especiales) {
            const cap = PERMISOS_ESPECIALES[e.permiso];
            if (cap) agregarCap(e.rol_id, cap);
            else avisos.push(`Permiso especial desconocido: "${e.permiso}" (rol ${e.rol_id}, sin capability)`);
        }

        const filasCaps = [];
        for (const [roleId, caps] of capsPorRol) {
            // El rol de sistema lleva SOLO el comodín: sumarle capabilities sueltas sería ruido.
            const lista = caps.has('*') ? ['*'] : [...caps];
            for (const capability of lista) {
                filasCaps.push({ roleId, capability, createdAt: AHORA, updatedAt: AHORA, deletedAt: null });
            }
        }
        await insertar('role_capabilities', filasCaps, trx);

        // ── 4. Usuarios ──────────────────────────────────────────────────────────────
        // El legado no tiene username (se loguea con email): se deriva del email, con
        // desempate numérico si dos usuarios comparten la parte local.
        const usuarios = await leer('usuarios');
        const usados = new Set();
        const filasUsuarios = usuarios.map((r) => {
            const base = slug(String(r.email || '').split('@')[0], '.') || slug(r.nombre, '.');
            let username = base;
            for (let i = 2; usados.has(username); i++) username = `${base}${i}`;
            usados.add(username);
            const { name, lastName } = partirNombre(r.nombre);
            return {
                id: r.id, name, lastName, email: r.email, username,
                // Hash bcrypt del legado tal cual: el nuevo lo verifica (back-compat) y lo
                // re-hashea a argon2id en el primer login exitoso. Nadie cambia de contraseña.
                password: r.password_hash,
                cellphone: null, avatar: null, avatarColor: null,
                active: r.activo, mfaEnabled: 0, mfaSecret: null, mfaBackupCodes: null,
                lastLoginAt: null, lastLoginIp: null,
                roleId: r.rol_id, ...fechas(r), deletedAt: borrado(r),
            };
        });
        await insertar('users', filasUsuarios, trx);

        await insertar('usuario_espacios', (await leer('usuario_espacios')).map((r) => ({
            id: r.id, userId: r.usuario_id, espacioId: r.espacio_id,
            ver: r.puede_ver, editar: r.puede_editar, ...fechas(r),
        })), trx);

        // ── 5. Tareas ────────────────────────────────────────────────────────────────
        // `orden` de listas no existe en el nuevo (se ordenan por nombre): se pierde.
        await insertar('listas', (await leer('listas')).map((r) => ({
            id: r.id, espacioId: r.espacio_id, nombre: r.nombre, descripcion: r.descripcion,
            activa: r.activa, ...fechas(r), deletedAt: borrado(r),
        })), trx);

        await insertar('tareas', (await leer('tareas')).map((r) => ({
            id: r.id, espacioId: r.espacio_id, listaId: r.lista_id, nombre: r.nombre,
            descripcion: r.descripcion, asignadoA: r.asignado_a, creadoPor: r.creado_por,
            prioridad: r.prioridad, estado: r.estado,
            fechaInicio: r.fecha_inicio, fechaVencimiento: r.fecha_vencimiento,
            ...fechas(r), deletedAt: borrado(r),
        })), trx);

        await insertar('tarea_estados', (await leer('tarea_estados')).map((r) => ({
            id: r.id, tareaId: r.tarea_id, estadoAnterior: r.estado_anterior,
            estadoNuevo: r.estado_nuevo, userId: r.usuario_id, createdAt: r.created_at || AHORA,
        })), trx);

        // ── 6. Empleados y sueldos ───────────────────────────────────────────────────
        await insertar('empleados', (await leer('empleados')).map((r) => ({
            id: r.id, nombre: r.nombre, dni: r.dni, cuil: r.cuil, nacionalidad: r.nacionalidad,
            fechaNacimiento: r.fecha_nacimiento, domicilio: r.domicilio, telefono: r.telefono,
            email: r.email, estadoCivil: r.estado_civil, cargasFamiliares: r.cargas_familiares,
            cuNombre: r.cu_nombre, cuTelefono: r.cu_telefono, cuParentesco: r.cu_parentesco,
            fechaIngreso: r.fecha_ingreso, observaciones: r.observaciones, categoria: r.categoria,
            vacDiasAnuales: r.vac_dias_anuales, sueldo: r.sueldo, activo: r.activo,
            ...fechas(r), deletedAt: borrado(r),
        })), trx);

        await insertar('empleado_areas', (await leer('empleado_areas')).map((r) => ({
            id: r.id, empleadoId: r.empleado_id, areaId: r.area_id, ...fechas(r),
        })), trx);

        const archivosEmpleado = await leer('empleado_archivos');
        if (archivosEmpleado.length) {
            avisos.push(`${archivosEmpleado.length} archivo(s) de empleados: se copiaron los registros, pero los binarios hay que moverlos a storage/empleados/<id>/`);
        }
        await insertar('empleado_archivos', archivosEmpleado.map((r) => ({
            id: r.id, empleadoId: r.empleado_id, descripcion: String(r.descripcion || '').slice(0, 200),
            nombre: String(r.archivo_path || '').split('/').pop(), nombreOriginal: r.archivo_nombre,
            mime: r.mime || 'application/octet-stream', size: r.tamano, userId: r.usuario_id,
            ...fechas(r),
        })), trx);

        await insertar('vacacion_asignaciones', (await leer('vacaciones_asignacion')).map((r) => ({
            id: r.id, empleadoId: r.empleado_id, anio: r.anio, dias: r.dias,
            createdAt: AHORA, updatedAt: AHORA, // el legado no guarda fecha en esta tabla
        })), trx);

        await insertar('vacacion_tomas', (await leer('vacaciones_tomadas')).map((r) => ({
            id: r.id, empleadoId: r.empleado_id, fechaDesde: r.fecha_desde, fechaHasta: r.fecha_hasta,
            dias: r.dias, observacion: r.observacion, userId: null, ...fechas(r),
        })), trx);

        await insertar('sueldo_actualizaciones', (await leer('sueldo_actualizaciones')).map((r) => ({
            id: r.id, empleadoId: r.empleado_id, fecha: r.fecha, sueldoAnterior: r.sueldo_anterior,
            sueldoNuevo: r.sueldo_nuevo, porcentaje: r.porcentaje, baseMes: r.base_mes,
            userId: r.usuario_id, createdAt: r.created_at || AHORA,
        })), trx);

        await insertar('sueldo_pagos', (await leer('sueldo_pagos')).map((r) => ({
            id: r.id, empleadoId: r.empleado_id, cuentaId: r.cuenta_id, anio: r.anio, mes: r.mes,
            monto: r.monto, pagado: r.pagado, fechaPago: r.fecha_pago, ...fechas(r),
        })), trx);

        await insertar('cuenta_disponibles', (await leer('cuenta_disponible')).map((r) => ({
            id: r.id, cuentaId: r.cuenta_id, anio: r.anio, mes: r.mes, monto: r.disponible,
            createdAt: AHORA, updatedAt: AHORA, // el legado no guarda fecha en esta tabla
        })), trx);

        // ── 7. Abonos y facturación ──────────────────────────────────────────────────
        await insertar('abonos', (await leer('abonos')).map((r) => ({
            id: r.id, clienteId: r.cliente_id, servicioId: r.servicio_id, descripcion: r.descripcion,
            moneda: r.moneda, precio: r.precio, fechaInicio: r.fecha_inicio, periodoMeses: r.periodo_meses,
            fechaUltimaActualizacion: r.fecha_ultima_actualizacion, formaFacturacionId: r.forma_facturacion_id,
            observaciones: r.observaciones, activo: r.activo, ...fechas(r), deletedAt: borrado(r),
        })), trx);

        // operationId queda NULL: la idempotencia por operación nace con el sistema nuevo.
        await insertar('abono_actualizaciones', (await leer('actualizaciones')).map((r) => ({
            id: r.id, abonoId: r.abono_id, fecha: r.fecha, moneda: r.moneda,
            precioAnterior: r.precio_anterior, precioNuevo: r.precio_nuevo, tipo: r.tipo,
            porcentaje: r.porcentaje, cotizacion: r.cotizacion, precioPesos: r.precio_pesos,
            userId: r.usuario_id, operationId: null, createdAt: r.created_at || AHORA,
        })), trx);

        // El legado no tenía anulación de facturas: todas entran como vigentes.
        await insertar('facturaciones', (await leer('facturaciones')).map((r) => ({
            id: r.id, abonoId: r.abono_id, clienteId: r.cliente_id, servicioId: r.servicio_id,
            anio: r.anio, mes: r.mes, moneda: r.moneda, precio: r.precio, cotizacion: r.cotizacion,
            montoPesos: r.monto_pesos, fecha: r.fecha, userId: r.usuario_id,
            anuladaAt: null, anuladaPor: null, motivoAnulacion: null, operationId: null,
            createdAt: r.created_at || AHORA,
        })), trx);

        // ── 8. Proyectos y cobranzas ─────────────────────────────────────────────────
        await insertar('proyectos', (await leer('proyectos')).map((r) => ({
            id: r.id, clienteId: r.cliente_id, nombre: r.nombre, servicioId: r.servicio_id,
            estado: r.estado, moneda: r.moneda, total: r.total,
            fechaConfirmacion: r.fecha_confirmacion, fechaOnboarding: r.fecha_onboarding,
            fechaAprobacionDiseno: r.fecha_aprobacion_diseno, fechaEstimadaEntrega: r.fecha_estimada_entrega,
            fechaEntrega: r.fecha_entrega, observaciones: r.observaciones,
            ...fechas(r), deletedAt: borrado(r),
        })), trx);

        await insertar('cobranzas', (await leer('cobranzas')).map((r) => ({
            id: r.id, proyectoId: r.proyecto_id, anio: r.anio, mes: r.mes, montoUsd: r.monto_usd,
            cobrado: r.cobrado, montoPesos: r.monto_pesos, cotizacion: r.cotizacion,
            fechaCobro: r.fecha_cobro, ...fechas(r), deletedAt: null,
        })), trx);

        // ── 9. Configuración de negocio ──────────────────────────────────────────────
        const config = await legado.query('SELECT * FROM configuracion', { type: QueryTypes.SELECT });
        let cotizacion = null;
        for (const c of config) {
            const name = CONFIG_KEYS[c.clave];
            if (!name) { avisos.push(`Clave de configuración desconocida: "${c.clave}" = ${c.valor} (no migrada)`); continue; }
            if (name === 'COTIZACION_DOLAR') cotizacion = c.valor;
            await db.query(
                'INSERT INTO `configs` (`name`,`value`,`description`,`updatable`,`createdAt`,`updatedAt`) VALUES (?,?,?,1,?,?) '
                + 'ON DUPLICATE KEY UPDATE `value`=VALUES(`value`), `updatedAt`=VALUES(`updatedAt`)',
                { replacements: [name, String(c.valor), null, AHORA, AHORA], transaction: trx },
            );
        }
        resumen.push({ tabla: 'configs (upsert)', filas: config.length });

        // Primer punto del histórico de cotización: el valor vigente al momento de migrar.
        if (cotizacion !== null) {
            await insertar('cotizacion_dolar', [{ valor: cotizacion, userId: null, createdAt: AHORA }], trx);
        }

        await trx.commit();
        console.log('✅ Datos copiados (transacción confirmada)');
    } catch (err) {
        await trx.rollback();
        console.error('❌ Migración abortada, no se cambió nada:', err.message);
        await legado.close();
        throw err;
    }

    // ── 10. AUTO_INCREMENT ───────────────────────────────────────────────────────────
    // Fuera de la transacción: ALTER TABLE es DDL (COMMIT implícito). Sin esto, el próximo
    // alta arrancaría en 1 y chocaría con los IDs importados.
    for (const tabla of TABLAS_AUTOINC) {
        const [{ siguiente }] = await db.query(
            `SELECT COALESCE(MAX(id), 0) + 1 AS siguiente FROM \`${tabla}\``,
            { type: QueryTypes.SELECT },
        );
        await db.query(`ALTER TABLE \`${tabla}\` AUTO_INCREMENT = ${Number(siguiente)}`);
    }
    console.log('🔢 AUTO_INCREMENT repuesto en las tablas importadas');

    // ── Informe ──────────────────────────────────────────────────────────────────────
    console.log('\n📊 Filas migradas');
    for (const r of resumen) console.log(`   ${r.tabla.padEnd(26)} ${String(r.filas).padStart(5)}`);
    console.log(`   ${'TOTAL'.padEnd(26)} ${String(resumen.reduce((a, r) => a + r.filas, 0)).padStart(5)}`);

    console.log('\n👤 Usuarios (entran con la MISMA contraseña que en el sistema PHP)');
    for (const u of await db.query('SELECT u.username, u.email, r.label AS rol FROM users u LEFT JOIN roles r ON r.id = u.roleId ORDER BY u.id', { type: QueryTypes.SELECT })) {
        console.log(`   ${String(u.username).padEnd(16)} ${String(u.email).padEnd(36)} ${u.rol || 'sin rol'}`);
    }

    if (avisos.length) {
        console.log('\n⚠️  Avisos');
        for (const a of avisos) console.log(`   - ${a}`);
    }

    await legado.close();
    await db.close();
    console.log('\n🏁 Migración completa');
};

main().catch((err) => {
    console.error('❌ Error en la migración:', err.message);
    process.exit(1);
});
