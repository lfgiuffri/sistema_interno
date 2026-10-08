import { DataTypes } from 'sequelize';

/** Tipos de trabajo que un agente puede ejecutar. */
export const TIPOS_TRABAJO = ['sql', 'deploy', 'rama'];

/**
 * Estados de un trabajo. El camino normal del SQL es:
 * `pendiente → canario → espera_ok → aprobado → corriendo → ok`.
 * Un deploy se saltea el canario: `pendiente → corriendo → ok`.
 */
export const ESTADOS_TRABAJO = [
    'pendiente',   // creado, esperando que el agente lo tome
    'canario',     // el agente está corriendo la prueba en UNA base
    'espera_ok',   // el canario terminó y espera la aprobación de una persona
    'aprobado',    // una persona dio el OK; esperando que el agente tome el resto
    'corriendo',   // ejecutando sobre el resto
    'ok',
    'error',
    'cancelado',   // alguien lo frenó antes de que el agente lo tomara
];

/** Estados en los que el trabajo ya terminó y no vuelve a moverse. */
export const ESTADOS_FINALES = ['ok', 'error', 'cancelado'];

/** Estados en los que el agente tiene algo que hacer. */
export const ESTADOS_TOMABLES = ['pendiente', 'aprobado'];

/**
 * Trabajo a ejecutar en UN servidor por su agente: correr SQL sobre las bases de los
 * clientes, o disparar un deploy de FullGlass.
 *
 * Es el reemplazo de entrar por SSH a cada VPS. El modelo es PULL: la app no se conecta a
 * ningún lado, el agente pregunta si tiene trabajo y lo ejecuta él. Así se mantiene la
 * propiedad de la que vive este módulo —ningún puerto abierto, cero credenciales de servidor
 * guardadas en la app— aun habilitando ejecución remota.
 *
 * Una fila POR SERVIDOR. Lanzar lo mismo en diez servidores crea diez trabajos con el mismo
 * `loteId`: así cada uno falla, se aprueba y se audita por separado, que es lo que hace falta
 * cuando un servidor tiene el esquema distinto a los demás.
 *
 * ⚠️ `sql` y `comando` se guardan tal cual se ejecutaron. Es a propósito: el historial tiene
 * que poder responder «qué le corrimos a este cliente en marzo», y para eso el texto exacto
 * es el dato.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo ServidorTrabajo.
 */
export const defineServidorTrabajoModel = (db) => {
    const ServidorTrabajo = db.define('servidor_trabajos', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        /** Agrupa los trabajos de un mismo lanzamiento (un lote = varios servidores). */
        loteId: { type: DataTypes.STRING(64), allowNull: false },
        servidorId: { type: DataTypes.INTEGER, allowNull: false },
        tipo: { type: DataTypes.ENUM(...TIPOS_TRABAJO), allowNull: false },
        estado: { type: DataTypes.ENUM(...ESTADOS_TRABAJO), allowNull: false, defaultValue: 'pendiente' },

        /** SQL a ejecutar (tipo `sql`). Puede traer varias sentencias. */
        sql: { type: DataTypes.TEXT, allowNull: true },
        /** Comando ya resuelto (tipo `deploy`): se COPIA del servidor al crear el trabajo. */
        comando: { type: DataTypes.TEXT, allowNull: true },
        entorno: { type: DataTypes.ENUM('produccion', 'desarrollo'), allowNull: true },
        /** Rama destino (tipo `rama`). Se manda explícita y no se alterna: ver el service. */
        rama: { type: DataTypes.STRING(60), allowNull: true },

        /**
         * Sitios elegidos, como array JSON de rutas. `null` = todos los que encuentre el
         * agente. La vista previa permite destildar alguno antes de lanzar.
         */
        sitios: { type: DataTypes.TEXT, allowNull: true },

        /** Quién lo lanzó y quién aprobó seguir después del canario (son dos actos distintos). */
        userId: { type: DataTypes.INTEGER, allowNull: true },
        aprobadoPorUserId: { type: DataTypes.INTEGER, allowNull: true },
        aprobadoAt: { type: DataTypes.DATE, allowNull: true },

        tomadoAt: { type: DataTypes.DATE, allowNull: true },
        finalizadoAt: { type: DataTypes.DATE, allowNull: true },
        /** Salida del comando (deploy) o resumen del error. Recortada: ver el service. */
        salida: { type: DataTypes.TEXT('medium'), allowNull: true },
        error: { type: DataTypes.STRING(500), allowNull: true }
    }, {
        tableName: 'servidor_trabajos',
        timestamps: true,
        // Bitácora de ejecuciones: no se borra ni se oculta. Si se pudiera eliminar, el
        // historial dejaría de servir justo para lo que existe.
        paranoid: false,
        indexes: [
            { fields: ['servidorId', 'estado'] },
            { fields: ['loteId'] },
            { fields: ['createdAt'] }
        ]
    });

    /**
     * Asociaciones: su servidor, quién lo lanzó y sus resultados por base.
     * @param {object} models - Modelos de la app.
     * @returns {void}
     */
    ServidorTrabajo.associate = (models) => {
        if (models.Servidor) ServidorTrabajo.belongsTo(models.Servidor, { foreignKey: 'servidorId' });
        if (models.User) ServidorTrabajo.belongsTo(models.User, { foreignKey: 'userId' });
        if (models.ServidorTrabajoResultado) {
            ServidorTrabajo.hasMany(models.ServidorTrabajoResultado, { foreignKey: 'trabajoId', as: 'resultados' });
        }
    };

    return ServidorTrabajo;
};
