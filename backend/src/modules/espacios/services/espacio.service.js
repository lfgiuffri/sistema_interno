/**
 * Service del módulo `espacios` — espacios de trabajo + la SEGUNDA capa de permisos.
 *
 * Reglas del legado (../analisis_app_php/03 §2.2 y §3):
 *  - Permiso efectivo sobre tareas = capability de sección Y permiso del espacio.
 *  - Admin (rol con `*`): todos los espacios con ver+editar, INCLUIDOS los inactivos.
 *  - editar implica ver; la matriz se edita desde dos ejes y cada eje reemplaza solo lo suyo;
 *    los admins nunca se tocan desde el eje espacio.
 *  - El creador NO admin queda con acceso total al espacio que crea (un admin ya entra
 *    por su rol: darle fila explícita solo lo duplicaría en el listado de accesos).
 *  - No se elimina un espacio con listas o tareas.
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
const bizError = (statusCode, message, extra = {}) => {
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
 * Permisos de espacios del usuario: mapa espacioId → { ver, editar, porRol }.
 * Admin: TODOS los espacios (incluidos inactivos) con acceso total. Resto: sus filas de
 * usuario_espacios, con `editar = editar && ver` (editar sin ver no vale).
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request ({ id, roleId }).
 * @returns {Promise<Record<number, {ver: boolean, editar: boolean, porRol: boolean}>>}
 */
export const getEspacioPermisos = async (models, user) => {
    const { EspacioTrabajo, UsuarioEspacio } = models;

    if (await esRolAdmin(models, user.roleId)) {
        const todos = await EspacioTrabajo.findAll({ attributes: ['id'], raw: true });
        return Object.fromEntries(todos.map(e => [e.id, { ver: true, editar: true, porRol: true }]));
    }

    const filas = await UsuarioEspacio.findAll({ where: { userId: user.id }, raw: true });
    return Object.fromEntries(filas.map(f => [
        f.espacioId,
        { ver: !!f.ver, editar: !!(f.editar && f.ver), porRol: false }
    ]));
};

/**
 * Exige permiso de VER sobre un espacio (capa 2). 403 con el mensaje del legado.
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} espacioId - Espacio a verificar.
 * @returns {Promise<Record<number, object>>} Los permisos (para reusar sin re-consultar).
 * @throws {Error} 403 si no puede ver.
 */
export const exigirEspacioVer = async (models, user, espacioId) => {
    const permisos = await getEspacioPermisos(models, user);
    if (!permisos[Number(espacioId)]?.ver) {
        throw bizError(403, 'No tenés acceso a este espacio de trabajo');
    }
    return permisos;
};

/**
 * Exige permiso de EDITAR sobre un espacio (capa 2). 403 con el mensaje del legado.
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} espacioId - Espacio a verificar.
 * @returns {Promise<Record<number, object>>} Los permisos (para reusar sin re-consultar).
 * @throws {Error} 403 si no puede editar.
 */
export const exigirEspacioEditar = async (models, user, espacioId) => {
    const permisos = await getEspacioPermisos(models, user);
    if (!permisos[Number(espacioId)]?.editar) {
        throw bizError(403, 'No tenés permiso para modificar tareas en este espacio de trabajo');
    }
    return permisos;
};

/**
 * Valida unicidad de nombre contra NO eliminados; si hay uno eliminado homónimo, ofrece
 * reactivarlo (mismo patrón que los catálogos — corrige el bug §3.2 del legado).
 * @param {object} models - Modelos de la app.
 * @param {string} nombre - Nombre a validar.
 * @param {number|null} excludeId - Id a excluir (edición).
 * @returns {Promise<void>}
 * @throws {Error} 400 si ya existe vivo; 409 EXISTE_ELIMINADO si hay uno eliminado.
 */
const checkNombreUnico = async (models, nombre, excludeId = null) => {
    const { EspacioTrabajo } = models;
    const idClause = excludeId ? { id: { [Op.ne]: excludeId } } : {};

    const vivo = await EspacioTrabajo.findOne({ where: { nombre, ...idClause } });
    if (vivo) throw bizError(400, 'Ya existe un espacio de trabajo con ese nombre');

    const eliminado = await EspacioTrabajo.findOne({ where: { nombre, ...idClause }, paranoid: false });
    if (eliminado && eliminado.deletedAt) {
        throw bizError(409, `Ya existió un espacio llamado «${nombre}» (eliminado). Podés reactivarlo.`, {
            errorCode: 'EXISTE_ELIMINADO',
            deletedId: eliminado.id
        });
    }
};

/**
 * Listado de administración: todos los espacios con conteos (listas, tareas) y el resumen
 * de accesos (admins por rol + usuarios con ver), en queries agregadas (sin N+1).
 * @param {object} models - Modelos de la app.
 * @returns {Promise<object[]>} Espacios con listasCount, tareasCount y usuarios[].
 */
export const listEspacios = async (models) => {
    const { EspacioTrabajo, UsuarioEspacio, Lista, Tarea, User, RoleCapability } = models;
    const espacios = await EspacioTrabajo.findAll({ order: [['nombre', 'ASC']] });
    if (!espacios.length) return [];
    const ids = espacios.map(e => e.id);

    /** Conteo agrupado por espacio para un modelo hijo. */
    const countPorEspacio = async (Model) => {
        if (!Model) return {};
        const rows = await Model.findAll({
            attributes: ['espacioId', [Model.sequelize.fn('COUNT', Model.sequelize.col('id')), 'n']],
            where: { espacioId: { [Op.in]: ids } },
            group: ['espacioId'],
            raw: true
        });
        return Object.fromEntries(rows.map(r => [r.espacioId, Number(r.n)]));
    };

    const [listas, tareas, accesos] = await Promise.all([
        countPorEspacio(Lista),
        countPorEspacio(Tarea),
        UsuarioEspacio.findAll({
            where: { espacioId: { [Op.in]: ids }, ver: true },
            include: [{ model: User, attributes: ['id', 'name', 'lastName', 'active', 'roleId'], paranoid: false }],
            raw: false
        })
    ]);

    // Admins por rol: roles con `*` → sus usuarios no eliminados (entran a todos los espacios).
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
        // Un admin con fila explícita (creador del espacio, o dato heredado del legado) ya
        // figura arriba por su rol: sin este salto aparecería DOS veces en la lista.
        if (idsRolAdmin.includes(a.user.roleId)) continue;
        (porEspacio[a.espacioId] ??= []).push({
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
        tareasCount: tareas[e.id] || 0,
        // Primero los admins (entran por rol), después los asignados — como el legado.
        usuarios: [...adminsShaped, ...(porEspacio[e.id] || [])]
    }));
};

/**
 * Un espacio por id.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id del espacio.
 * @returns {Promise<object|null>} El espacio o null.
 */
export const getEspacio = (models, id) => models.EspacioTrabajo.findByPk(id);

/**
 * Crea un espacio. El CREADOR queda siempre con acceso total (regla dura del legado:
 * no puede quedarse afuera de lo que acaba de crear, sea admin o no).
 * @param {object} models - Modelos de la app.
 * @param {object} data - { nombre, descripcion?, activo? }.
 * @param {number} userId - Usuario creador.
 * @returns {Promise<object>} El espacio creado.
 */
export const createEspacio = async (models, data, userId) => {
    const { EspacioTrabajo, UsuarioEspacio } = models;
    await checkNombreUnico(models, data.nombre);

    // Un admin ya entra a todo por su rol: darle además fila explícita lo duplicaría en
    // el listado de accesos. La fila es para el creador NO admin, que sí podría quedarse afuera.
    const creadorEsAdmin = await esRolAdmin(models, (await models.User.findByPk(userId))?.roleId);

    return EspacioTrabajo.sequelize.transaction(async (t) => {
        const espacio = await EspacioTrabajo.create(data, { transaction: t });
        if (!creadorEsAdmin) {
            // upsert: si ya tuviera fila (imposible en alta, defensivo), la pisa con acceso total.
            await UsuarioEspacio.upsert(
                { userId, espacioId: espacio.id, ver: true, editar: true },
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
export const updateEspacio = async (models, id, data) => {
    const espacio = await models.EspacioTrabajo.findByPk(id);
    if (!espacio) return null;
    if (data.nombre && data.nombre !== espacio.nombre) {
        await checkNombreUnico(models, data.nombre, id);
    }
    await espacio.update(data);
    return espacio;
};

/**
 * Alterna el estado activo (un espacio inactivo no aparece en Tareas pero conserva todo).
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id del espacio.
 * @returns {Promise<object|null>} El espacio actualizado o null.
 */
export const toggleEspacio = async (models, id) => {
    const espacio = await models.EspacioTrabajo.findByPk(id);
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
export const restoreEspacio = async (models, id) => {
    const { EspacioTrabajo } = models;
    const espacio = await EspacioTrabajo.findByPk(id, { paranoid: false });
    if (!espacio || !espacio.deletedAt) return null;

    const vivo = await EspacioTrabajo.findOne({ where: { nombre: espacio.nombre } });
    if (vivo) throw bizError(400, 'Ya existe un espacio activo con ese nombre; renombralo primero');

    await espacio.restore();
    return espacio;
};

/**
 * Elimina (soft) un espacio. Protección del legado: con listas o tareas no se elimina.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id del espacio.
 * @returns {Promise<boolean>} true si se eliminó; false si no existe.
 * @throws {Error} 409 si tiene contenido.
 */
export const deleteEspacio = async (models, id) => {
    const { EspacioTrabajo, Lista, Tarea, UsuarioEspacio } = models;
    const espacio = await EspacioTrabajo.findByPk(id);
    if (!espacio) return false;

    const partes = [];
    if (Lista) {
        const n = await Lista.count({ where: { espacioId: id } });
        if (n > 0) partes.push(`${n} lista(s)`);
    }
    if (Tarea) {
        const n = await Tarea.count({ where: { espacioId: id } });
        if (n > 0) partes.push(`${n} tarea(s)`);
    }
    if (partes.length) {
        throw bizError(409, `No se puede eliminar: el espacio tiene ${partes.join(' y ')}. Eliminalas primero.`);
    }

    // Las filas de acceso ya no sirven para nada: se limpian (hard, no son bitácora).
    await UsuarioEspacio.destroy({ where: { espacioId: id } });
    await espacio.destroy();
    return true;
};

/**
 * Matriz del EJE ESPACIO: usuarios gestionables (no-admin, no eliminados) con sus permisos
 * actuales + los admins como filas informativas (por rol, sin checkboxes).
 * @param {object} models - Modelos de la app.
 * @param {number} espacioId - Espacio.
 * @returns {Promise<object[]|null>} Filas de la matriz o null si el espacio no existe.
 */
export const getMatrizEspacio = async (models, espacioId) => {
    const { EspacioTrabajo, UsuarioEspacio, User, RoleCapability } = models;
    const espacio = await EspacioTrabajo.findByPk(espacioId);
    if (!espacio) return null;

    const rolesAdmin = (await RoleCapability.findAll({ where: { capability: '*' }, attributes: ['roleId'], raw: true }))
        .map(r => r.roleId);

    const usuarios = await User.findAll({
        attributes: ['id', 'name', 'lastName', 'active', 'roleId'],
        order: [['name', 'ASC'], ['lastName', 'ASC']]
    });
    const filas = await UsuarioEspacio.findAll({ where: { espacioId }, raw: true });
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
 * (los admins nunca se tocan desde este eje — si se los incluyera en el DELETE perderían
 * el acceso explícito que pudieran tener). editar⇒ver; todo-en-0 no inserta fila.
 * @param {object} models - Modelos de la app.
 * @param {number} espacioId - Espacio.
 * @param {Array<{userId: number, ver: boolean, editar: boolean}>} entradas - Permisos nuevos.
 * @returns {Promise<boolean>} true si guardó; false si el espacio no existe.
 */
export const setMatrizEspacio = async (models, espacioId, entradas = []) => {
    const { EspacioTrabajo, UsuarioEspacio, User, RoleCapability } = models;
    const espacio = await EspacioTrabajo.findByPk(espacioId);
    if (!espacio) return false;

    const rolesAdmin = (await RoleCapability.findAll({ where: { capability: '*' }, attributes: ['roleId'], raw: true }))
        .map(r => r.roleId);
    const gestionables = (await User.findAll({
        where: rolesAdmin.length ? { roleId: { [Op.notIn]: rolesAdmin } } : {},
        attributes: ['id'],
        raw: true
    })).map(u => u.id);

    await UsuarioEspacio.sequelize.transaction(async (t) => {
        // Cada eje reemplaza SOLO su propio eje: acá, las filas de este espacio para gestionables.
        await UsuarioEspacio.destroy({
            where: { espacioId, userId: { [Op.in]: gestionables } },
            transaction: t
        });
        const filas = entradas
            .filter(e => gestionables.includes(Number(e.userId)))
            .map(e => ({ espacioId, userId: Number(e.userId), ver: !!e.ver, editar: !!(e.editar && e.ver) }))
            .filter(e => e.ver); // todo-en-0 no se inserta
        if (filas.length) await UsuarioEspacio.bulkCreate(filas, { transaction: t });
    });
    return true;
};

/**
 * Matriz del EJE USUARIO: espacios (no eliminados) con los permisos del usuario.
 * Si el usuario es admin devuelve porRol=true en todos (informativo, no editable).
 * @param {object} models - Modelos de la app.
 * @param {number} userId - Usuario.
 * @returns {Promise<{porRol: boolean, espacios: object[]}|null>} Matriz o null si no existe.
 */
export const getEspaciosUsuario = async (models, userId) => {
    const { EspacioTrabajo, UsuarioEspacio, User } = models;
    const user = await User.findByPk(userId);
    if (!user) return null;

    const esAdmin = await esRolAdmin(models, user.roleId);
    const espacios = await EspacioTrabajo.findAll({ order: [['nombre', 'ASC']] });
    const filas = esAdmin ? [] : await UsuarioEspacio.findAll({ where: { userId }, raw: true });
    const porEspacio = Object.fromEntries(filas.map(f => [f.espacioId, f]));

    return {
        porRol: esAdmin,
        espacios: espacios.map(e => ({
            espacioId: e.id,
            nombre: e.nombre,
            activo: !!e.activo,
            ver: esAdmin ? true : !!porEspacio[e.id]?.ver,
            editar: esAdmin ? true : !!(porEspacio[e.id]?.editar && porEspacio[e.id]?.ver)
        }))
    };
};

/**
 * Guarda la matriz del EJE USUARIO: borra TODAS las filas del usuario y reinserta
 * (espacios existentes; editar⇒ver; todo-en-0 no inserta). Un admin no se toca (403).
 * @param {object} models - Modelos de la app.
 * @param {number} userId - Usuario.
 * @param {Array<{espacioId: number, ver: boolean, editar: boolean}>} entradas - Permisos nuevos.
 * @returns {Promise<boolean>} true si guardó; false si el usuario no existe.
 * @throws {Error} 403 si el usuario es admin (entra por rol, su matriz no se edita).
 */
export const setEspaciosUsuario = async (models, userId, entradas = []) => {
    const { EspacioTrabajo, UsuarioEspacio, User } = models;
    const user = await User.findByPk(userId);
    if (!user) return false;

    if (await esRolAdmin(models, user.roleId)) {
        throw bizError(403, 'Un administrador entra a todos los espacios por su rol; su matriz no se edita');
    }

    const validos = (await EspacioTrabajo.findAll({ attributes: ['id'], raw: true })).map(e => e.id);

    await UsuarioEspacio.sequelize.transaction(async (t) => {
        // Este eje reemplaza SOLO lo suyo: todas las filas del usuario.
        await UsuarioEspacio.destroy({ where: { userId }, transaction: t });
        const filas = entradas
            .filter(e => validos.includes(Number(e.espacioId)))
            .map(e => ({ userId, espacioId: Number(e.espacioId), ver: !!e.ver, editar: !!(e.editar && e.ver) }))
            .filter(e => e.ver);
        if (filas.length) await UsuarioEspacio.bulkCreate(filas, { transaction: t });
    });
    return true;
};
