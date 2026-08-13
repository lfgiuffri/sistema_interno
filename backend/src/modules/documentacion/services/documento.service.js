/**
 * Service del módulo `documentacion` — listas y documentos dentro de un espacio.
 *
 * Reglas:
 *  - Permiso de DOS CAPAS: capability `documentacion:*` (por ruta) Y ver/editar del espacio
 *    (lo exige este service con los helpers de docEspacio.service).
 *  - El cuerpo del documento es HTML del editor: se sanea en servidor al GUARDAR y al SERVIR
 *    (misma lista blanca que las descripciones de tareas).
 *  - Cada edición que cambia título o contenido archiva la versión ANTERIOR en
 *    `documento_versiones` (bitácora append-only): nada se pisa sin dejar rastro.
 *  - `orden` sostiene el drag & drop de listas y documentos (menor primero, desempata nombre).
 *  - Colaborativo: los documentos son de la empresa, NO se filtran por autor; `creadoPor` y
 *    `actualizadoPor` son autoría, no propiedad.
 */

import { Op } from 'sequelize';
import { sanearHtml } from '../../../services/html/sanitizador.service.js';
import { bizError, exigirDocEspacioVer, exigirDocEspacioEditar, getDocEspacioPermisos } from './docEspacio.service.js';
import { ligarImagenes } from './archivoDoc.service.js';

/** Campos del autor/editor que se exponen en las respuestas. */
const USER_ATTRS = ['id', 'name', 'lastName'];

/**
 * Nombre visible de un usuario incluido (o null).
 * @param {object|null} u - Instancia de User incluida.
 * @returns {string|null} "Nombre Apellido" o null.
 */
const nombreUsuario = (u) => (u ? `${u.name} ${u.lastName}`.trim() : null);

/**
 * Adjuntos por documento (una sola query agrupada).
 * @param {object} models - Modelos de la app.
 * @param {number[]} ids - Documentos.
 * @returns {Promise<Record<number, number>>} Mapa documentoId → cantidad de adjuntos.
 */
const contarAdjuntos = async (models, ids) => {
    if (!ids.length) return {};
    const { DocumentoArchivo } = models;
    const rows = await DocumentoArchivo.findAll({
        attributes: ['documentoId', [DocumentoArchivo.sequelize.fn('COUNT', DocumentoArchivo.sequelize.col('id')), 'n']],
        where: { documentoId: { [Op.in]: ids }, tipo: 'archivo' },
        group: ['documentoId'],
        raw: true
    });
    return Object.fromEntries(rows.map(r => [r.documentoId, Number(r.n)]));
};

// ─── Listas ──────────────────────────────────────────────────────────────────────────

/**
 * Valida unicidad del nombre de lista DENTRO del espacio (contra no eliminadas).
 * @param {object} models - Modelos de la app.
 * @param {number} docEspacioId - Espacio.
 * @param {string} nombre - Nombre a validar.
 * @param {number|null} excludeId - Id a excluir (edición).
 * @returns {Promise<void>}
 * @throws {Error} 400 si ya existe; 409 EXISTE_ELIMINADO si hay una eliminada homónima.
 */
const checkListaUnica = async (models, docEspacioId, nombre, excludeId = null) => {
    const { DocLista } = models;
    const idClause = excludeId ? { id: { [Op.ne]: excludeId } } : {};

    const viva = await DocLista.findOne({ where: { docEspacioId, nombre, ...idClause } });
    if (viva) throw bizError(400, 'Ya existe una lista con ese nombre en este espacio');

    const eliminada = await DocLista.findOne({ where: { docEspacioId, nombre, ...idClause }, paranoid: false });
    if (eliminada && eliminada.deletedAt) {
        throw bizError(409, `Ya existió una lista llamada «${nombre}» (eliminada). Podés reactivarla.`, {
            errorCode: 'EXISTE_ELIMINADO',
            deletedId: eliminada.id
        });
    }
};

/**
 * Listas de un espacio con el conteo de documentos de cada una.
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} docEspacioId - Espacio.
 * @returns {Promise<{espacio: object, puedeEditar: boolean, listas: object[]}>}
 * @throws {Error} 403 sin acceso al espacio; 404 si el espacio no existe.
 */
export const listListas = async (models, user, docEspacioId) => {
    const { DocEspacio, DocLista, Documento } = models;
    const permisos = await exigirDocEspacioVer(models, user, docEspacioId);

    const espacio = await DocEspacio.findByPk(docEspacioId);
    if (!espacio) throw bizError(404, 'Espacio de documentación no encontrado');

    const listas = await DocLista.findAll({
        where: { docEspacioId },
        order: [['orden', 'ASC'], ['nombre', 'ASC']]
    });

    const conteos = listas.length
        ? Object.fromEntries((await Documento.findAll({
            attributes: ['docListaId', [Documento.sequelize.fn('COUNT', Documento.sequelize.col('id')), 'n']],
            where: { docListaId: { [Op.in]: listas.map(l => l.id) } },
            group: ['docListaId'],
            raw: true
        })).map(r => [r.docListaId, Number(r.n)]))
        : {};

    return {
        espacio: { id: espacio.id, nombre: espacio.nombre, descripcion: espacio.descripcion, activo: espacio.activo },
        puedeEditar: !!permisos[Number(docEspacioId)]?.editar,
        listas: listas.map(l => ({ ...l.toJSON(), documentosCount: conteos[l.id] || 0 }))
    };
};

/**
 * Crea una lista al final del espacio (orden = máximo + 10).
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} docEspacioId - Espacio.
 * @param {object} data - { nombre, descripcion? }.
 * @returns {Promise<object>} La lista creada.
 */
export const createLista = async (models, user, docEspacioId, data) => {
    const { DocEspacio, DocLista } = models;
    await exigirDocEspacioEditar(models, user, docEspacioId);
    if (!await DocEspacio.findByPk(docEspacioId)) throw bizError(404, 'Espacio de documentación no encontrado');

    await checkListaUnica(models, docEspacioId, data.nombre);
    const max = Number(await DocLista.max('orden', { where: { docEspacioId } })) || 0;
    return DocLista.create({ ...data, docEspacioId, orden: max + 10 });
};

/**
 * Actualiza una lista (título, descripción).
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} docEspacioId - Espacio.
 * @param {number} listaId - Lista.
 * @param {object} data - Campos a actualizar.
 * @returns {Promise<object|null>} La lista actualizada o null si no existe.
 */
export const updateLista = async (models, user, docEspacioId, listaId, data) => {
    const { DocLista } = models;
    await exigirDocEspacioEditar(models, user, docEspacioId);

    const lista = await DocLista.findOne({ where: { id: listaId, docEspacioId } });
    if (!lista) return null;
    if (data.nombre && data.nombre !== lista.nombre) {
        await checkListaUnica(models, docEspacioId, data.nombre, listaId);
    }
    await lista.update(data);
    return lista;
};

/**
 * Alterna el estado activo de una lista (cosmético: se ve atenuada).
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} docEspacioId - Espacio.
 * @param {number} listaId - Lista.
 * @returns {Promise<object|null>} La lista o null.
 */
export const toggleLista = async (models, user, docEspacioId, listaId) => {
    const { DocLista } = models;
    await exigirDocEspacioEditar(models, user, docEspacioId);
    const lista = await DocLista.findOne({ where: { id: listaId, docEspacioId } });
    if (!lista) return null;
    await lista.update({ activa: !lista.activa });
    return lista;
};

/**
 * Reactiva una lista eliminada del espacio.
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} docEspacioId - Espacio.
 * @param {number} listaId - Lista eliminada.
 * @returns {Promise<object|null>} La lista restaurada o null.
 */
export const restoreLista = async (models, user, docEspacioId, listaId) => {
    const { DocLista } = models;
    await exigirDocEspacioEditar(models, user, docEspacioId);
    const lista = await DocLista.findOne({ where: { id: listaId, docEspacioId }, paranoid: false });
    if (!lista || !lista.deletedAt) return null;

    const viva = await DocLista.findOne({ where: { docEspacioId, nombre: lista.nombre } });
    if (viva) throw bizError(400, 'Ya existe una lista activa con ese nombre; renombrala primero');

    await lista.restore();
    return lista;
};

/**
 * Elimina (soft) una lista. Con documentos adentro no se elimina (409).
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} docEspacioId - Espacio.
 * @param {number} listaId - Lista.
 * @returns {Promise<boolean>} true si se eliminó; false si no existe.
 * @throws {Error} 409 si tiene documentos.
 */
export const deleteLista = async (models, user, docEspacioId, listaId) => {
    const { DocLista, Documento } = models;
    await exigirDocEspacioEditar(models, user, docEspacioId);

    const lista = await DocLista.findOne({ where: { id: listaId, docEspacioId } });
    if (!lista) return false;

    const n = await Documento.count({ where: { docListaId: listaId } });
    if (n > 0) throw bizError(409, `No se puede eliminar: la lista tiene ${n} documento(s). Movelos o eliminalos primero.`);

    await lista.destroy();
    return true;
};

/**
 * Reordena las listas de un espacio (drag & drop): el orden del array manda.
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} docEspacioId - Espacio.
 * @param {number[]} ids - Ids en el orden deseado.
 * @returns {Promise<number>} Cantidad de listas reordenadas.
 */
export const reordenarListas = async (models, user, docEspacioId, ids) => {
    const { DocLista } = models;
    await exigirDocEspacioEditar(models, user, docEspacioId);

    const propias = (await DocLista.findAll({ where: { docEspacioId }, attributes: ['id'], raw: true })).map(l => l.id);
    const orden = ids.map(Number).filter(id => propias.includes(id));

    await DocLista.sequelize.transaction(async (t) => {
        // Múltiplos de 10: deja lugar para insertar sin renumerar todo.
        for (const [i, id] of orden.entries()) {
            await DocLista.update({ orden: (i + 1) * 10 }, { where: { id, docEspacioId }, transaction: t });
        }
    });
    return orden.length;
};

// ─── Documentos ──────────────────────────────────────────────────────────────────────

/**
 * Forma de salida de un documento para el listado (sin cuerpo, con extracto).
 * @param {object} d - Instancia de Documento (con autor/editor incluidos).
 * @param {number} [archivosCount] - Adjuntos del documento (se cuenta aparte, sin N+1).
 * @returns {object} Documento liviano para listar.
 */
const shapeListado = (d, archivosCount = 0) => {
    const json = d.toJSON();
    const texto = String(json.contenido || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
    return {
        id: json.id,
        docEspacioId: json.docEspacioId,
        docListaId: json.docListaId,
        titulo: json.titulo,
        extracto: texto.slice(0, 180),
        tieneTexto: !!texto,
        archivosCount,
        orden: json.orden,
        autor: nombreUsuario(json.autor),
        editor: nombreUsuario(json.editor),
        createdAt: json.createdAt,
        updatedAt: json.updatedAt
    };
};

/**
 * Documentos de una lista (livianos, ordenados por `orden`).
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} docEspacioId - Espacio.
 * @param {number} listaId - Lista.
 * @returns {Promise<{espacio: object, lista: object, puedeEditar: boolean, documentos: object[]}>}
 */
export const listDocumentos = async (models, user, docEspacioId, listaId) => {
    const { DocEspacio, DocLista, Documento, DocumentoArchivo, User } = models;
    const permisos = await exigirDocEspacioVer(models, user, docEspacioId);

    const espacio = await DocEspacio.findByPk(docEspacioId);
    if (!espacio) throw bizError(404, 'Espacio de documentación no encontrado');
    const lista = await DocLista.findOne({ where: { id: listaId, docEspacioId } });
    if (!lista) throw bizError(404, 'Lista no encontrada');

    const documentos = await Documento.findAll({
        where: { docListaId: listaId },
        include: [
            { model: User, as: 'autor', attributes: USER_ATTRS, required: false, paranoid: false },
            { model: User, as: 'editor', attributes: USER_ATTRS, required: false, paranoid: false }
        ],
        order: [['orden', 'ASC'], ['titulo', 'ASC']]
    });

    const adjuntos = await contarAdjuntos(models, documentos.map(d => d.id));

    return {
        espacio: { id: espacio.id, nombre: espacio.nombre },
        lista: { id: lista.id, nombre: lista.nombre, descripcion: lista.descripcion, activa: lista.activa },
        puedeEditar: !!permisos[Number(docEspacioId)]?.editar,
        documentos: documentos.map(d => shapeListado(d, adjuntos[d.id] || 0))
    };
};

/**
 * Un documento completo: cuerpo saneado al servir, adjuntos y datos de autoría.
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} id - Documento.
 * @returns {Promise<object|null>} El documento o null si no existe.
 * @throws {Error} 403 si no tiene acceso al espacio.
 */
export const getDocumento = async (models, user, id) => {
    const { Documento, DocumentoArchivo, DocLista, User } = models;
    const doc = await Documento.findByPk(id, {
        include: [
            { model: User, as: 'autor', attributes: USER_ATTRS, required: false, paranoid: false },
            { model: User, as: 'editor', attributes: USER_ATTRS, required: false, paranoid: false }
        ]
    });
    if (!doc) return null;

    const permisos = await exigirDocEspacioVer(models, user, doc.docEspacioId);
    const json = doc.toJSON();

    const [lista, archivos] = await Promise.all([
        DocLista.findByPk(doc.docListaId, { attributes: ['id', 'nombre'], paranoid: false }),
        DocumentoArchivo.findAll({ where: { documentoId: doc.id, tipo: 'archivo' }, order: [['createdAt', 'ASC']] })
    ]);

    return {
        ...json,
        // Sanear al SERVIR también: el contenido puede ser anterior a un cambio de lista blanca.
        contenido: sanearHtml(json.contenido),
        autor: nombreUsuario(json.autor),
        editor: nombreUsuario(json.editor),
        lista: lista ? { id: lista.id, nombre: lista.nombre } : null,
        archivos: archivos.map(a => ({ ...a.toJSON(), url: `/api/documentacion/archivos/${a.nombre}` })),
        puedeEditar: !!permisos[doc.docEspacioId]?.editar
    };
};

/**
 * Crea un documento al final de su lista.
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {object} data - { docEspacioId, docListaId, titulo, contenido? }.
 * @returns {Promise<object>} El documento creado (forma completa).
 */
export const createDocumento = async (models, user, data) => {
    const { DocLista, Documento } = models;
    await exigirDocEspacioEditar(models, user, data.docEspacioId);

    const lista = await DocLista.findOne({ where: { id: data.docListaId, docEspacioId: data.docEspacioId } });
    if (!lista) throw bizError(404, 'Lista no encontrada en este espacio');

    const contenido = sanearHtml(data.contenido) || null;
    const max = Number(await Documento.max('orden', { where: { docListaId: data.docListaId } })) || 0;

    const doc = await Documento.create({
        docEspacioId: data.docEspacioId,
        docListaId: data.docListaId,
        titulo: data.titulo,
        contenido,
        orden: max + 10,
        creadoPor: user.id,
        actualizadoPor: user.id
    });

    // Las imágenes embebidas quedan ligadas al documento (para el GC de huérfanas).
    await ligarImagenes(models, doc.id, contenido);
    return getDocumento(models, user, doc.id);
};

/**
 * Actualiza un documento. Si cambia el título o el cuerpo, ARCHIVA la versión anterior.
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} id - Documento.
 * @param {object} data - { titulo?, contenido? }.
 * @returns {Promise<object|null>} El documento actualizado o null si no existe.
 */
export const updateDocumento = async (models, user, id, data) => {
    const { Documento, DocumentoVersion } = models;
    const doc = await Documento.findByPk(id);
    if (!doc) return null;
    await exigirDocEspacioEditar(models, user, doc.docEspacioId);

    const titulo = data.titulo ?? doc.titulo;
    const contenido = data.contenido !== undefined ? (sanearHtml(data.contenido) || null) : doc.contenido;
    const cambio = titulo !== doc.titulo || contenido !== doc.contenido;

    if (cambio) {
        await Documento.sequelize.transaction(async (t) => {
            // Se archiva el estado que se está pisando, con su autor (quien lo dejó así).
            await DocumentoVersion.create({
                documentoId: doc.id,
                titulo: doc.titulo,
                contenido: doc.contenido,
                userId: doc.actualizadoPor || doc.creadoPor,
                createdAt: doc.updatedAt
            }, { transaction: t });
            await doc.update({ titulo, contenido, actualizadoPor: user.id }, { transaction: t });
        });
        await ligarImagenes(models, doc.id, contenido);
    }

    return getDocumento(models, user, doc.id);
};

/**
 * Mueve un documento a otra lista (del mismo o de otro espacio, si puede editar los dos).
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} id - Documento.
 * @param {{docEspacioId: number, docListaId: number}} destino - Lista destino.
 * @returns {Promise<object|null>} El documento movido o null si no existe.
 */
export const moverDocumento = async (models, user, id, destino) => {
    const { Documento, DocLista } = models;
    const doc = await Documento.findByPk(id);
    if (!doc) return null;

    // Editar en ORIGEN y en DESTINO (mover saca contenido de un espacio y lo mete en otro).
    await exigirDocEspacioEditar(models, user, doc.docEspacioId);
    await exigirDocEspacioEditar(models, user, destino.docEspacioId);

    const lista = await DocLista.findOne({ where: { id: destino.docListaId, docEspacioId: destino.docEspacioId } });
    if (!lista) throw bizError(404, 'Lista destino no encontrada en ese espacio');

    const max = Number(await Documento.max('orden', { where: { docListaId: destino.docListaId } })) || 0;
    await doc.update({
        docEspacioId: destino.docEspacioId,
        docListaId: destino.docListaId,
        orden: max + 10,
        actualizadoPor: user.id
    });
    return getDocumento(models, user, doc.id);
};

/**
 * Reordena los documentos de una lista (drag & drop).
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} docEspacioId - Espacio.
 * @param {number} listaId - Lista.
 * @param {number[]} ids - Ids en el orden deseado.
 * @returns {Promise<number>} Cantidad de documentos reordenados.
 */
export const reordenarDocumentos = async (models, user, docEspacioId, listaId, ids) => {
    const { Documento } = models;
    await exigirDocEspacioEditar(models, user, docEspacioId);

    const propios = (await Documento.findAll({
        where: { docListaId: listaId, docEspacioId }, attributes: ['id'], raw: true
    })).map(d => d.id);
    const orden = ids.map(Number).filter(id => propios.includes(id));

    await Documento.sequelize.transaction(async (t) => {
        for (const [i, id] of orden.entries()) {
            await Documento.update({ orden: (i + 1) * 10 }, { where: { id }, transaction: t });
        }
    });
    return orden.length;
};

/**
 * Elimina (soft) un documento. Sus versiones quedan (son bitácora) y sus adjuntos se
 * desligan para que el GC recoja los binarios.
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} id - Documento.
 * @returns {Promise<boolean>} true si se eliminó; false si no existe.
 */
export const deleteDocumento = async (models, user, id) => {
    const { Documento, DocumentoArchivo } = models;
    const doc = await Documento.findByPk(id);
    if (!doc) return false;
    await exigirDocEspacioEditar(models, user, doc.docEspacioId);

    await DocumentoArchivo.update({ documentoId: null }, { where: { documentoId: id } });
    await doc.destroy();
    return true;
};

/**
 * Historial de versiones de un documento (más nuevas primero).
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} id - Documento.
 * @returns {Promise<object[]|null>} Versiones o null si el documento no existe.
 */
export const listVersiones = async (models, user, id) => {
    const { Documento, DocumentoVersion, User } = models;
    const doc = await Documento.findByPk(id);
    if (!doc) return null;
    await exigirDocEspacioVer(models, user, doc.docEspacioId);

    const versiones = await DocumentoVersion.findAll({
        where: { documentoId: id },
        include: [{ model: User, attributes: USER_ATTRS, required: false, paranoid: false }],
        order: [['createdAt', 'DESC'], ['id', 'DESC']]
    });

    return versiones.map(v => {
        const json = v.toJSON();
        return {
            id: json.id,
            titulo: json.titulo,
            contenido: sanearHtml(json.contenido),
            usuario: nombreUsuario(json.user),
            createdAt: json.createdAt
        };
    });
};

/**
 * Restaura una versión: la escribe como estado actual (y por lo tanto archiva la que estaba,
 * sin perder nada — el historial es append-only).
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} id - Documento.
 * @param {number} versionId - Versión a restaurar.
 * @returns {Promise<object|null>} El documento resultante o null si no existe.
 */
export const restaurarVersion = async (models, user, id, versionId) => {
    const { Documento, DocumentoVersion } = models;
    const doc = await Documento.findByPk(id);
    if (!doc) return null;
    await exigirDocEspacioEditar(models, user, doc.docEspacioId);

    const version = await DocumentoVersion.findOne({ where: { id: versionId, documentoId: id } });
    if (!version) throw bizError(404, 'Versión no encontrada');

    return updateDocumento(models, user, id, { titulo: version.titulo, contenido: version.contenido });
};

/**
 * Buscador: título y contenido, acotado a los espacios que el usuario puede VER.
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {{q: string, docEspacioId?: number, limit?: number}} filtros - Criterios.
 * @returns {Promise<object[]>} Documentos livianos con su espacio y lista.
 */
export const buscarDocumentos = async (models, user, filtros) => {
    const { Documento, DocEspacio, DocLista, DocumentoArchivo, User } = models;
    const q = String(filtros.q || '').trim();
    if (q.length < 2) return [];

    const permisos = await getDocEspacioPermisos(models, user);
    let visibles = Object.entries(permisos).filter(([, p]) => p.ver).map(([id]) => Number(id));
    if (filtros.docEspacioId) {
        // Filtro por espacio: solo vale si además lo puede ver.
        visibles = visibles.filter(id => id === Number(filtros.docEspacioId));
    }
    if (!visibles.length) return [];

    const like = { [Op.like]: `%${q}%` };
    const documentos = await Documento.findAll({
        where: {
            docEspacioId: { [Op.in]: visibles },
            [Op.or]: [{ titulo: like }, { contenido: like }]
        },
        include: [
            { model: User, as: 'autor', attributes: USER_ATTRS, required: false, paranoid: false },
            { model: User, as: 'editor', attributes: USER_ATTRS, required: false, paranoid: false }
        ],
        order: [['updatedAt', 'DESC']],
        limit: Math.min(Number(filtros.limit) || 30, 100)
    });
    if (!documentos.length) return [];

    // Nombres de espacio y lista por mapa (dos queries fijas, sin N+1).
    const [espacios, listas, adjuntos] = await Promise.all([
        DocEspacio.findAll({ where: { id: { [Op.in]: [...new Set(documentos.map(d => d.docEspacioId))] } }, attributes: ['id', 'nombre'], raw: true }),
        DocLista.findAll({ where: { id: { [Op.in]: [...new Set(documentos.map(d => d.docListaId))] } }, attributes: ['id', 'nombre'], raw: true, paranoid: false }),
        contarAdjuntos(models, documentos.map(d => d.id))
    ]);
    const porEspacio = Object.fromEntries(espacios.map(e => [e.id, e]));
    const porLista = Object.fromEntries(listas.map(l => [l.id, l]));

    return documentos.map(d => ({
        ...shapeListado(d, adjuntos[d.id] || 0),
        espacio: porEspacio[d.docEspacioId] || null,
        lista: porLista[d.docListaId] || null
    }));
};
