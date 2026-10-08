import { body, param, query } from 'express-validator';
import { validator } from '../../../kernel/index.js';

export const validateId = [
    param('id').isInt({ min: 1 }),
    validator
];

/** Campos comunes de alta/edición de servidor. */
const camposServidor = [
    body('nombre').isString().trim().notEmpty().withMessage('El nombre es obligatorio').isLength({ max: 120 }),
    // IPv4/IPv6 o hostname: hay VPS a los que se llega por nombre y no por IP fija.
    body('ip').isString().trim().notEmpty().withMessage('La IP o host es obligatoria').isLength({ max: 45 }),
    body('activo').optional().isBoolean().toBoolean(),
    body('monitorea').optional().isBoolean().toBoolean(),
    body('puertoChequeo').optional().isInt({ min: 1, max: 65535 }).toInt(),
    // null = usar el umbral global.
    body('umbralCpu').optional({ nullable: true }).isInt({ min: 50, max: 100 }).toInt(),
    body('umbralRam').optional({ nullable: true }).isInt({ min: 50, max: 100 }).toInt(),
    body('umbralDisco').optional({ nullable: true }).isInt({ min: 50, max: 100 }).toInt(),
    // Qué alertas crea este servidor (todas true por defecto en el modelo).
    body('alertaOffline').optional().isBoolean().toBoolean(),
    body('alertaCpu').optional().isBoolean().toBoolean(),
    body('alertaRam').optional().isBoolean().toBoolean(),
    body('alertaDisco').optional().isBoolean().toBoolean(),
    body('observaciones').optional({ nullable: true }).isString().trim(),
    // Dato de inventario: si este VPS aloja FullGlass. Habilita las pantallas de SQL masivo y
    // deploy, pero por sí solo no deja ejecutar nada (eso pide las capabilities `*-ejecutar`),
    // ni configurar el comando (eso pide `servidores:deploy-config`).
    body('tieneFullglass').optional().isBoolean().toBoolean(),
];

/**
 * Configuración de la actualización de bases (`servidores:bd-config`).
 *
 * ⚠️ Va en un endpoint propio y NO en el PUT del servidor a propósito: `matchedData` whitelistea,
 * así que quien tiene `servidores:update` no puede tocar esto aunque lo mande en el body.
 */
export const validateConfigBd = [
    param('id').isInt({ min: 1 }),
    // Dónde declara cada cliente su rama dentro de config_site.php.
    body('claveRama').optional().isString().trim().notEmpty().isLength({ max: 60 }),
    body('rutaSitios').isString().trim().notEmpty().withMessage('La ruta a recorrer es obligatoria')
        .isLength({ max: 255 })
        // Ruta absoluta y sin `..`: el agente la usa para recorrer el disco del servidor.
        .matches(/^\/[^\s]*$/).withMessage('Tiene que ser una ruta absoluta')
        .custom(v => !v.includes('..')).withMessage('La ruta no puede contener «..»'),
    validator
];

/**
 * Comandos de deploy (`servidores:deploy-config`). Corren COMO ROOT en el VPS: editar esto es
 * tan sensible como tener acceso al servidor, por eso su capability es distinta de la que
 * habilita apretar el botón de deploy.
 */
export const validateConfigDeploy = [
    param('id').isInt({ min: 1 }),
    // ⚠️ `optional({ values: 'undefined' })` y NO `optional({ nullable: true })`: con `nullable`
    // express-validator SALTEA la validación cuando el valor es null, y entonces `matchedData`
    // descarta el campo — mandar null no borraba nada y un comando de deploy quedaba puesto
    // para siempre. Acá null se valida (y pasa), así que llega al service y limpia.
    // La cadena vacía se normaliza a null: «borrarlo» desde un textarea es dejarlo en blanco.
    body('comandoDeployProd').optional({ values: 'undefined' })
        .customSanitizer(v => (v === null || String(v).trim() === '' ? null : v))
        .custom(v => v === null || (typeof v === 'string' && v.length <= 2000))
        .withMessage('El comando no puede superar los 2000 caracteres'),
    body('comandoDeployDev').optional({ values: 'undefined' })
        .customSanitizer(v => (v === null || String(v).trim() === '' ? null : v))
        .custom(v => v === null || (typeof v === 'string' && v.length <= 2000))
        .withMessage('El comando no puede superar los 2000 caracteres'),
    // Script que cambia de rama. Acepta los marcadores {sitio} y {rama}.
    body('comandoCambiarRama').optional({ values: 'undefined' })
        .customSanitizer(v => (v === null || String(v).trim() === '' ? null : v))
        .custom(v => v === null || (typeof v === 'string' && v.length <= 2000))
        .withMessage('El comando no puede superar los 2000 caracteres'),
    validator
];

/** Análisis de riesgo de un SQL, antes de lanzarlo. */
export const validateAnalizarSql = [
    body('sql').isString().notEmpty().withMessage('Escribí el SQL').isLength({ max: 200000 }),
    validator
];

/** Lanzamiento de un lote de trabajos. */
export const validateCrearTrabajos = [
    body('tipo').isIn(['sql', 'deploy', 'rama']).withMessage('Tipo de trabajo inválido'),
    body('servidorIds').isArray({ min: 1, max: 50 }).withMessage('Elegí al menos un servidor'),
    body('servidorIds.*').isInt({ min: 1 }).toInt(),
    body('sql').if(body('tipo').equals('sql')).isString().notEmpty().withMessage('Escribí el SQL').isLength({ max: 200000 }),
    body('entorno').if(body('tipo').equals('deploy')).isIn(['produccion', 'desarrollo']).withMessage('Entorno inválido'),
    // La rama destino va EXPLÍCITA y no se alterna: si la app y el servidor están desfasados
    // un momento, alternar mandaría al cliente a la rama contraria a la que se quiso.
    body('rama').if(body('tipo').equals('rama')).isString().trim().notEmpty().isLength({ max: 60 })
        .withMessage('Elegí la rama destino'),
    // Sitios elegidos en la vista previa. Vacío/ausente = todos los que encuentre el agente.
    body('sitios').optional({ nullable: true }).isArray({ max: 500 }),
    body('sitios.*').isString().isLength({ max: 255 }),
    // La palabra que habilita las sentencias peligrosas (el service exige «CONFIRMO»).
    body('confirmacion').optional().isString().isLength({ max: 20 }),
    validator
];

/** Filtros del historial de trabajos. */
export const validateListTrabajos = [
    query('servidorId').optional({ checkFalsy: true }).isInt({ min: 1 }).toInt(),
    query('tipo').optional({ checkFalsy: true }).isIn(['sql', 'deploy', 'rama']),
    query('estado').optional({ checkFalsy: true }).isString(),
    query('limit').optional({ checkFalsy: true }).isInt({ min: 1, max: 500 }).toInt(),
    validator
];

export const validateCreate = [...camposServidor, validator];

export const validateUpdate = [
    param('id').isInt({ min: 1 }),
    ...camposServidor,
    validator
];

/** Campos comunes de alta/edición de sitio web. */
const camposSitio = [
    body('nombre').isString().trim().notEmpty().withMessage('El nombre es obligatorio').isLength({ max: 150 }),
    body('url').isString().trim().notEmpty().withMessage('La URL es obligatoria').isLength({ max: 255 }),
    body('servicioId').optional({ nullable: true }).isInt({ min: 1 }).toInt(),
    body('servidorId').optional({ nullable: true }).isInt({ min: 1 }).toInt(),
    body('activo').optional().isBoolean().toBoolean(),
    body('verificaMarcador').optional().isBoolean().toBoolean(),
    // FullGlass: hay sitios viejos que no lo usan, y sin esto no se pueden distinguir.
    body('usaFullglass').optional().isBoolean().toBoolean(),
    // Carpeta del cliente en el servidor. Absoluta y sin «..»: es lo que después se le pasa al
    // script que cambia de rama, que corre como root.
    body('rutaFullglass').optional({ values: 'undefined' })
        .customSanitizer(v => (v === null || String(v).trim() === '' ? null : String(v).trim()))
        .custom(v => v === null || (/^\/[^\s]*$/.test(v) && !v.includes('..')))
        .withMessage('Tiene que ser una ruta absoluta, sin espacios ni «..»'),
    // Fecha manual. El vacío llega como CADENA vacía —no como null— a propósito: con
    // `optional({ nullable: true })` express-validator considera el null "ausente" y lo saca
    // de `matchedData`, así que el borrado nunca llegaría al service. El service la
    // normaliza a null.
    body('dominioVenceAt')
        .optional()
        .custom((v) => v === '' || /^\d{4}-\d{2}-\d{2}/.test(String(v)))
        .withMessage('La fecha de vencimiento no es válida'),
    body('observacion').optional({ nullable: true }).isString().trim(),
];

export const validateCreateSitio = [...camposSitio, validator];

export const validateUpdateSitio = [
    param('id').isInt({ min: 1 }),
    ...camposSitio,
    validator
];

/** Campos comunes de alta/edición de una vista de sitio. */
const camposVista = [
    // La ruta la normaliza el service (`/tienda/` → `/tienda`, y acepta una URL completa):
    // acá solo se controla el largo y que sea texto.
    body('ruta').optional().isString().trim().isLength({ max: 190 }),
    body('nombre').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
    body('verificaMarcador').optional().isBoolean().toBoolean(),
    // Cadena vacía = «usá el marcador global». Igual que `dominioVenceAt`: con
    // `optional({ nullable: true })` el null se cae de `matchedData` y el borrado no llegaría
    // nunca al service.
    body('marcadorId')
        .optional()
        .custom((v) => v === '' || /^[A-Za-z][A-Za-z0-9_:-]{0,63}$/.test(String(v)))
        .withMessage('El id del marcador tiene que empezar con una letra y usar solo letras, números, guiones, guiones bajos o dos puntos'),
    body('activo').optional().isBoolean().toBoolean(),
];

export const validateCreateVista = [
    param('id').isInt({ min: 1 }),
    // En el alta la ruta es obligatoria: una vista sin ruta sería un duplicado de la home,
    // que ya existe siempre.
    body('ruta').isString().trim().notEmpty().withMessage('La ruta es obligatoria').isLength({ max: 190 }),
    ...camposVista.slice(1),
    validator
];

export const validateUpdateVista = [
    param('id').isInt({ min: 1 }),
    ...camposVista,
    validator
];

export const validateOrdenVistas = [
    param('id').isInt({ min: 1 }),
    body('ids').isArray({ min: 1, max: 100 }).withMessage('Hace falta la lista de ids'),
    body('ids.*').isInt({ min: 1 }).toInt(),
    validator
];

export const validateVelocidad = [
    param('id').isInt({ min: 1 }),
    query('granularidad').optional().isIn(['hora', 'dia', 'mes', 'anio']).withMessage('La granularidad tiene que ser hora, dia, mes o anio'),
    query('vistaId').optional().isInt({ min: 1 }).toInt(),
    validator
];

/** Reporte del agente: porcentajes 0-100 y el detalle de discos. */
export const validateIngesta = [
    body('cpu').isFloat({ min: 0, max: 100 }).toFloat(),
    body('ram').isFloat({ min: 0, max: 100 }).toFloat(),
    body('disco').isFloat({ min: 0, max: 100 }).toFloat(),
    body('discos').optional().isArray({ max: 20 }),
    body('discos.*.montaje').optional().isString().isLength({ max: 60 }),
    body('discos.*.uso').optional().isFloat({ min: 0, max: 100 }).toFloat(),
    body('discos.*.libreGb').optional().isFloat({ min: 0 }).toFloat(),
    body('carga1').optional().isFloat({ min: 0 }).toFloat(),
    body('uptimeSeg').optional().isInt({ min: 0 }).toInt(),
    body('so').optional().isString().isLength({ max: 120 }),
    validator
];
