/**
 * Espacios de documentación + la SEGUNDA capa de permisos del módulo.
 *
 * Mismas reglas que los espacios de tareas (../analisis_app_php/03 §2.2 y §3), aplicadas a
 * sus propias tablas:
 *  - Permiso efectivo = capability `documentacion:*` Y permiso del espacio (ver/editar).
 *  - Admin (rol con `*`): todos los espacios con ver+editar, INCLUIDOS los inactivos.
 *  - editar implica ver; la matriz se edita desde dos ejes y cada eje reemplaza solo lo suyo;
 *    los admins nunca se tocan desde el eje espacio.
 *  - El creador NO admin queda con acceso total al espacio que crea (un admin ya entra
 *    por su rol: darle fila explícita solo lo duplicaría en el listado de accesos).
 *  - No se elimina un espacio con listas o documentos.
 *
 * `esRolAdmin` se resuelve acá con el kernel (y no importando el módulo `espacios`) para no
 * acoplar documentación a un módulo con el que solo comparte la FORMA de los permisos.
 */

import { Op } from 'sequelize';
import { getRoleCapabilities } from '../../../kernel/index.js';

/**
 * Error de negocio con status y datos extra (el controller lo mapea al envelope).
 * @param {number} statusCode - HTTP status.
 * @param {string} message - Mensaje para el usuario.
 * @param {object} [extra] - Campos extra ({ errorCode, deletedId, ... }).
 * @returns {Error} Error enriquecido.
 */
export const bizError = (statusCode, message, extra = {}) => {
    const err = new Error(message);
    err.statusCode = statusCode;
    Object.assign(err, extra);
    return err;
};

/**
 * ¿El rol es administrador (capability comodín)?
 * @param {object} models - Modelos de la app.
 * @param {number} roleId - Rol a consultar.
 * @returns {Promise<boolean>} true si el rol tiene `*`.
 */
export const esRolAdmin = async (models, roleId) => {
    const caps = await getRoleCapabilities(models, 'default', roleId);
    return caps.includes('*');
};

/**
 * Permisos de espacios de documentación del usuario: mapa id → { ver, editar, porRol }.
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request ({ id, roleId }).
 * @returns {Promise<Record<number, {ver: boolean, editar: boolean, porRol: boolean}>>}
 */
export const getDocEspacioPermisos = async (models, user) => {
    const { DocEspacio, UsuarioDocEspacio } = models;

    if (await esRolAdmin(models, user.roleId)) {
        const todos = await DocEspacio.findAll({ attributes: ['id'], raw: true });
        return Object.fromEntries(todos.map(e => [e.id, { ver: true, editar: true, porRol: true }]));
    }

    const filas = await UsuarioDocEspacio.findAll({ where: { userId: user.id }, raw: true });
    return Object.fromEntries(filas.map(f => [
        f.docEspacioId,
        { ver: !!f.ver, editar: !!(f.editar && f.ver), porRol: false }
    ]));
};

/**
 * Exige permiso de VER sobre un espacio de documentación (capa 2).
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} docEspacioId - Espacio a verificar.
 * @returns {Promise<Record<number, object>>} Los permisos (para reusar sin re-consultar).
 * @throws {Error} 403 si no puede ver.
 */
export const exigirDocEspacioVer = async (models, user, docEspacioId) => {
    const permisos = await getDocEspacioPermisos(models, user);
    if (!permisos[Number(docEspacioId)]?.ver) {
        throw bizError(403, 'No tenés acceso a este espacio de documentación');
    }
    return permisos;
};

/**
 * Exige permiso de EDITAR sobre un espacio de documentación (capa 2).
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} docEspacioId - Espacio a verificar.
 * @returns {Promise<Record<number, object>>} Los permisos (para reusar sin re-consultar).
 * @throws {Error} 403 si no puede editar.
 */
export const exigirDocEspacioEditar = async (models, user, docEspacioId) => {
    const permisos = await getDocEspacioPermisos(models, user);
    if (!permisos[Number(docEspacioId)]?.editar) {
        throw bizError(403, 'No tenés permiso para modificar documentación en este espacio');
    }
    return permisos;
};

/**
 * Valida unicidad de nombre contra NO eliminados; si hay uno eliminado homónimo, ofrece
 * reactivarlo (mismo patrón que los catálogos).
 * @param {object} models - Modelos de la app.
 * @param {string} nombre - Nombre a validar.
 * @param {number|null} excludeId - Id a excluir (edición).
 * @returns {Promise<void>}
 * @throws {Error} 400 si ya existe vivo; 409 EXISTE_ELIMINADO si hay uno eliminado.
 */
const checkNombreUnico = async (models, nombre, excludeId = null) => {
    const { DocEspacio } = models;
    const idClause = excludeId ? { id: { [Op.ne]: excludeId } } : {};

    const vivo = await DocEspacio.findOne({ where: { nombre, ...idClause } });
    if (vivo) throw bizError(400, 'Ya existe un espacio de documentación con ese nombre');

    const eliminado = await DocEspacio.findOne({ where: { nombre, ...idClause }, paranoid: false });
    if (eliminado && eliminado.deletedAt) {
        throw bizError(409, `Ya existió un espacio llamado «${nombre}» (eliminado). Podés reactivarlo.`, {
            errorCode: 'EXISTE_ELIMINADO',
            deletedId: eliminado.id
        });
    }
};

/**
 * Home de Documentación: los espacios que el usuario puede VER, con conteos.
 * Los inactivos solo los ve el admin (igual que en tareas).
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @returns {Promise<object[]>} Espacios con listasCount, documentosCount y puedeEditar.
 */
export const homeDocEspacios = async (models, user) => {
    const { DocEspacio, DocLista, Documento } = models;
    const permisos = await getDocEspacioPermisos(models, user);
    const visibles = Object.entries(permisos).filter(([, p]) => p.ver).map(([id]) => Number(id));
    if (!visibles.length) return [];

    const admin = await esRolAdmin(models, user.roleId);
    const espacios = await DocEspacio.findAll({
        where: { id: { [Op.in]: visibles }, ...(admin ? {} : { activo: true }) },
        order: [['nombre', 'ASC']]
    });
    if (!espacios.length) return [];
    const ids = espacios.map(e => e.id);

    /** Conteo agrupado por espacio para un modelo hijo. */
    const contar = async (Model) => {
        if (!Model) return {};
        const rows = await Model.findAll({
            attributes: ['docEspacioId', [Model.sequelize.fn('COUNT', Model.sequelize.col('id')), 'n']],
            where: { docEspacioId: { [Op.in]: ids } },
            group: ['docEspacioId'],
            raw: true
        });
        return Object.fromEntries(rows.map(r => [r.docEspacioId, Number(r.n)]));
    };

    const [listas, documentos] = await Promise.all([contar(DocLista), contar(Documento)]);

    return espacios.map(e => ({
        ...e.toJSON(),
        listasCount: listas[e.id] || 0,
        documentosCount: documentos[e.id] || 0,
        puedeEditar: !!permisos[e.id]?.editar
    }));
};

/**
 * Listado de ADMINISTRACIÓN: todos los espacios con conteos y el resumen de accesos
 * (admins por rol + usuarios con ver), en queries agregadas (sin N+1).
 * @param {object} models - Modelos de la app.
 * @returns {Promise<object[]>} Espacios con listasCount, documentosCount y usuarios[].
 */
export const listDocEspacios = async (models) => {
    const { DocEspacio, UsuarioDocEspacio, DocLista, Documento, User, RoleCapability } = models;
    const espacios = await DocEspacio.findAll({ order: [['nombre', 'ASC']] });
    if (!espacios.length) return [];
    const ids = espacios.map(e => e.id);

    /** Conteo agrupado por espacio para un modelo hijo. */
    const contar = async (Model) => {
        if (!Model) return {};
        const rows = await Model.findAll({
            attributes: ['docEspacioId', [Model.sequelize.fn('COUNT', Model.sequelize.col('id')), 'n']],
            where: { docEspacioId: { [Op.in]: ids } },
            group: ['docEspacioId'],
            raw: true
        });
        return Object.fromEntries(rows.map(r => [r.docEspacioId, Number(r.n)]));
    };

    const [listas, documentos, accesos] = await Promise.all([
        contar(DocLista),
        contar(Documento),
        UsuarioDocEspacio.findAll({
            where: { docEspacioId: { [Op.in]: ids }, ver: true },
            include: [{ model: User, attributes: ['id', 'name', 'lastName', 'active', 'roleId'], paranoid: false }]
        })
    ]);

    // Admins por rol: roles con `*` → sus usuarios (entran a todos los espacios).
    const rolesAdmin = await RoleCapability.findAll({ where: { capability: '*' }, attributes: ['roleId'], raw: true });
    const admins = rolesAdmin.length
        ? await User.findAll({
            where: { roleId: { [Op.in]: rolesAdmin.map(r => r.roleId) } },
            attributes: ['id', 'name', 'lastName', 'active']
        })
        : [];
    const adminsShaped = admins.map(u => ({
        id: u.id, nombre: `${u.name} ${u.lastName}`.trim(), activo: !!u.active, porRol: true, ver: true, editar: true
    }));

    const idsRolAdmin = rolesAdmin.map(r => r.roleId);

    const porEspacio = {};
    for (const a of accesos) {
        if (!a.user) continue;
        // Un admin con fila explícita (creador del espacio) ya figura arriba por su rol:
        // sin este salto aparecería DOS veces en la lista.
        if (idsRolAdmin.includes(a.user.roleId)) continue;
        (porEspacio[a.docEspacioId] ??= []).push({
            id: a.user.id,
            nombre: `${a.user.name} ${a.user.lastName}`.trim(),
            activo: !!a.user.active,
            porRol: false,
            ver: !!a.ver,
            editar: !!(a.editar && a.ver)
        });
    }

    return espacios.map(e => ({
        ...e.toJSON(),
        listasCount: listas[e.id] || 0,
        documentosCount: documentos[e.id] || 0,
        usuarios: [...adminsShaped, ...(porEspacio[e.id] || [])]
    }));
};

/**
 * Crea un espacio. El CREADOR queda siempre con acceso total.
 * @param {object} models - Modelos de la app.
 * @param {object} data - { nombre, descripcion?, activo? }.
 * @param {number} userId - Usuario creador.
 * @returns {Promise<object>} El espacio creado.
 */
export const createDocEspacio = async (models, data, userId) => {
    const { DocEspacio, UsuarioDocEspacio } = models;
    await checkNombreUnico(models, data.nombre);

    // Un admin ya entra a todo por su rol: darle además fila explícita lo duplicaría en
    // el listado de accesos. La fila es para el creador NO admin, que sí podría quedarse afuera.
    const creadorEsAdmin = await esRolAdmin(models, (await models.User.findByPk(userId))?.roleId);

    return DocEspacio.sequelize.transaction(async (t) => {
        const espacio = await DocEspacio.create(data, { transaction: t });
        if (!creadorEsAdmin) {
            await UsuarioDocEspacio.upsert(
                { userId, docEspacioId: espacio.id, ver: true, editar: true },
                { transaction: t }
            );
        }
        return espacio;
    });
};

/**
 * Actualiza nombre/descripcion/activo de un espacio.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id a editar.
 * @param {object} data - Campos a actualizar.
 * @returns {Promise<object|null>} El espacio actualizado o null si no existe.
 */
export const updateDocEspacio = async (models, id, data) => {
    const espacio = await models.DocEspacio.findByPk(id);
    if (!espacio) return null;
    if (data.nombre && data.nombre !== espacio.nombre) {
        await checkNombreUnico(models, data.nombre, id);
    }
    await espacio.update(data);
    return espacio;
};

/**
 * Alterna el estado activo (un espacio inactivo no aparece en la home pero conserva todo).
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id del espacio.
 * @returns {Promise<object|null>} El espacio actualizado o null.
 */
export const toggleDocEspacio = async (models, id) => {
    const espacio = await models.DocEspacio.findByPk(id);
    if (!espacio) return null;
    await espacio.update({ activo: !espacio.activo });
    return espacio;
};

/**
 * Reactiva un espacio eliminado.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id del espacio eliminado.
 * @returns {Promise<object|null>} El espacio restaurado o null si no existe.
 */
export const restoreDocEspacio = async (models, id) => {
    const { DocEspacio } = models;
    const espacio = await DocEspacio.findByPk(id, { paranoid: false });
    if (!espacio || !espacio.deletedAt) return null;

    const vivo = await DocEspacio.findOne({ where: { nombre: espacio.nombre } });
    if (vivo) throw bizError(400, 'Ya existe un espacio activo con ese nombre; renombralo primero');

    await espacio.restore();
    return espacio;
};

/**
 * Elimina (soft) un espacio. Con listas o documentos no se elimina.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id del espacio.
 * @returns {Promise<boolean>} true si se eliminó; false si no existe.
 * @throws {Error} 409 si tiene contenido.
 */
export const deleteDocEspacio = async (models, id) => {
    const { DocEspacio, DocLista, Documento, UsuarioDocEspacio } = models;
    const espacio = await DocEspacio.findByPk(id);
    if (!espacio) return false;

    const partes = [];
    const nListas = await DocLista.count({ where: { docEspacioId: id } });
    if (nListas > 0) partes.push(`${nListas} lista(s)`);
    const nDocs = await Documento.count({ where: { docEspacioId: id } });
    if (nDocs > 0) partes.push(`${nDocs} documento(s)`);
    if (partes.length) {
        throw bizError(409, `No se puede eliminar: el espacio tiene ${partes.join(' y ')}. Eliminalos primero.`);
    }

    // Las filas de acceso ya no sirven para nada: se limpian (hard, no son bitácora).
    await UsuarioDocEspacio.destroy({ where: { docEspacioId: id } });
    await espacio.destroy();
    return true;
};

/**
 * Matriz del EJE ESPACIO: usuarios gestionables (no-admin) con sus permisos actuales +
 * los admins como filas informativas (por rol, sin checkboxes).
 * @param {object} models - Modelos de la app.
 * @param {number} docEspacioId - Espacio.
 * @returns {Promise<object[]|null>} Filas de la matriz o null si el espacio no existe.
 */
export const getMatrizDocEspacio = async (models, docEspacioId) => {
    const { DocEspacio, UsuarioDocEspacio, User, RoleCapability } = models;
    const espacio = await DocEspacio.findByPk(docEspacioId);
    if (!espacio) return null;

    const rolesAdmin = (await RoleCapability.findAll({ where: { capability: '*' }, attributes: ['roleId'], raw: true }))
        .map(r => r.roleId);

    const usuarios = await User.findAll({
        attributes: ['id', 'name', 'lastName', 'active', 'roleId'],
        order: [['name', 'ASC'], ['lastName', 'ASC']]
    });
    const filas = await UsuarioDocEspacio.findAll({ where: { docEspacioId }, raw: true });
    const porUsuario = Object.fromEntries(filas.map(f => [f.userId, f]));

    return usuarios.map(u => {
        const esAdmin = rolesAdmin.includes(u.roleId);
        const fila = porUsuario[u.id];
        return {
            userId: u.id,
            nombre: `${u.name} ${u.lastName}`.trim(),
            activo: !!u.active,
            porRol: esAdmin,
            ver: esAdmin ? true : !!fila?.ver,
            editar: esAdmin ? true : !!(fila?.editar && fila?.ver)
        };
    });
};

/**
 * Guarda la matriz del EJE ESPACIO: reemplaza SOLO las filas de los usuarios gestionables
 * (los admins nunca se tocan desde este eje). editar⇒ver; todo-en-0 no inserta fila.
 * @param {object} models - Modelos de la app.
 * @param {number} docEspacioId - Espacio.
 * @param {Array<{userId: number, ver: boolean, editar: boolean}>} entradas - Permisos nuevos.
 * @returns {Promise<boolean>} true si guardó; false si el espacio no existe.
 */
export const setMatrizDocEspacio = async (models, docEspacioId, entradas = []) => {
    const { DocEspacio, UsuarioDocEspacio, User, RoleCapability } = models;
    const espacio = await DocEspacio.findByPk(docEspacioId);
    if (!espacio) return false;

    const rolesAdmin = (await RoleCapability.findAll({ where: { capability: '*' }, attributes: ['roleId'], raw: true }))
        .map(r => r.roleId);
    const gestionables = (await User.findAll({
        where: rolesAdmin.length ? { roleId: { [Op.notIn]: rolesAdmin } } : {},
        attributes: ['id'],
        raw: true
    })).map(u => u.id);

    await UsuarioDocEspacio.sequelize.transaction(async (t) => {
        await UsuarioDocEspacio.destroy({
            where: { docEspacioId, userId: { [Op.in]: gestionables } },
            transaction: t
        });
        const filas = entradas
            .filter(e => gestionables.includes(Number(e.userId)))
            .map(e => ({ docEspacioId, userId: Number(e.userId), ver: !!e.ver, editar: !!(e.editar && e.ver) }))
            .filter(e => e.ver);
        if (filas.length) await UsuarioDocEspacio.bulkCreate(filas, { transaction: t });
    });
    return true;
};

/**
 * Matriz del EJE USUARIO: espacios de documentación con los permisos del usuario.
 * @param {object} models - Modelos de la app.
 * @param {number} userId - Usuario.
 * @returns {Promise<{porRol: boolean, espacios: object[]}|null>} Matriz o null si no existe.
 */
export const getDocEspaciosUsuario = async (models, userId) => {
    const { DocEspacio, UsuarioDocEspacio, User } = models;
    const user = await User.findByPk(userId);
    if (!user) return null;

    const esAdmin = await esRolAdmin(models, user.roleId);
    const espacios = await DocEspacio.findAll({ order: [['nombre', 'ASC']] });
    const filas = esAdmin ? [] : await UsuarioDocEspacio.findAll({ where: { userId }, raw: true });
    const porEspacio = Object.fromEntries(filas.map(f => [f.docEspacioId, f]));

    return {
        porRol: esAdmin,
        espacios: espacios.map(e => ({
            docEspacioId: e.id,
            nombre: e.nombre,
            activo: !!e.activo,
            ver: esAdmin ? true : !!porEspacio[e.id]?.ver,
            editar: esAdmin ? true : !!(porEspacio[e.id]?.editar && porEspacio[e.id]?.ver)
        }))
    };
};

/**
 * Guarda la matriz del EJE USUARIO: borra TODAS las filas del usuario y reinserta.
 * @param {object} models - Modelos de la app.
 * @param {number} userId - Usuario.
 * @param {Array<{docEspacioId: number, ver: boolean, editar: boolean}>} entradas - Permisos nuevos.
 * @returns {Promise<boolean>} true si guardó; false si el usuario no existe.
 * @throws {Error} 403 si el usuario es admin (entra por rol, su matriz no se edita).
 */
export const setDocEspaciosUsuario = async (models, userId, entradas = []) => {
    const { DocEspacio, UsuarioDocEspacio, User } = models;
    const user = await User.findByPk(userId);
    if (!user) return false;

    if (await esRolAdmin(models, user.roleId)) {
        throw bizError(403, 'Un administrador entra a todos los espacios por su rol; su matriz no se edita');
    }

    const validos = (await DocEspacio.findAll({ attributes: ['id'], raw: true })).map(e => e.id);

    await UsuarioDocEspacio.sequelize.transaction(async (t) => {
        await UsuarioDocEspacio.destroy({ where: { userId }, transaction: t });
        const filas = entradas
            .filter(e => validos.includes(Number(e.docEspacioId)))
            .map(e => ({ userId, docEspacioId: Number(e.docEspacioId), ver: !!e.ver, editar: !!(e.editar && e.ver) }))
            .filter(e => e.ver);
        if (filas.length) await UsuarioDocEspacio.bulkCreate(filas, { transaction: t });
    });
    return true;
};
