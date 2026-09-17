import { DataTypes } from 'sequelize';

/**
 * Eventos que se le pueden avisar al cliente por mail. `creada` es el alta; el resto son los
 * estados a los que puede llegar la incidencia.
 */
export const EVENTOS_INCIDENCIA = ['creada', 'nueva', 'en_progreso', 'resuelta'];

/**
 * Modelo IncidenciaCambio: bitácora append-only de la incidencia **y outbox del mail**.
 *
 * Las dos cosas en una tabla a propósito. La bitácora registra SIEMPRE lo que pasó —es
 * auditoría, no puede depender de si el cliente pidió o no que le avisen—, y el envío del
 * mail se resuelve después leyendo las filas pendientes.
 *
 * Por qué outbox y no mandar el mail en el momento:
 *  - La fila se escribe DENTRO de la transacción del cambio de estado, así que un rollback no
 *    deja un mail mandado avisando algo que no pasó.
 *  - Un SMTP lento no cuelga el request del usuario, y uno caído no pierde el aviso: la fila
 *    queda pendiente y el próximo tick la reintenta.
 *  - Permite AGRUPAR: 20 tareas de un lote son un mail, no 20.
 *
 * `notificado` distingue «se mandó» de «se omitió porque ese cliente no pidió este aviso», y
 * en los dos casos se estampa `notificadoAt` para no reintentar para siempre. Sin esa
 * distinción, el día que un cliente diga «no me llegó nada» no habría forma de saber si fue
 * un problema de correo o su propia configuración.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo IncidenciaCambio.
 */
export const defineIncidenciaCambioModel = (db) => {
    const IncidenciaCambio = db.define('incidencia_cambios', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        incidenciaId: { type: DataTypes.INTEGER, allowNull: false },
        evento: { type: DataTypes.ENUM(...EVENTOS_INCIDENCIA), allowNull: false },
        estadoAnterior: { type: DataTypes.STRING(20), allowNull: true },
        estadoNuevo: { type: DataTypes.STRING(20), allowNull: true },
        /** Texto para el cuerpo del mail (ej. «la tarea vinculada se eliminó»). */
        detalle: { type: DataTypes.STRING(255), allowNull: true },
        /** Quién lo provocó. Solo una de las dos tiene valor (ver Incidencia). */
        userId: { type: DataTypes.INTEGER, allowNull: true },
        clienteUsuarioId: { type: DataTypes.INTEGER, allowNull: true },
        /** null = pendiente de procesar por el outbox. */
        notificadoAt: { type: DataTypes.DATE, allowNull: true },
        /** true = se mandó el mail; false = se omitió por la configuración del cliente. */
        notificado: { type: DataTypes.BOOLEAN, allowNull: true },
        createdAt: { type: DataTypes.DATE, allowNull: false }
    }, {
        tableName: 'incidencia_cambios',
        timestamps: true,
        updatedAt: false,   // bitácora: una fila no se edita
        indexes: [
            { fields: ['incidenciaId', 'createdAt'] },
            // El índice que usa el tick del outbox para encontrar lo pendiente.
            { fields: ['notificadoAt'] }
        ]
    });

    IncidenciaCambio.associate = (models) => {
        if (models.Incidencia) IncidenciaCambio.belongsTo(models.Incidencia, { foreignKey: 'incidenciaId' });
        if (models.User) IncidenciaCambio.belongsTo(models.User, { foreignKey: 'userId' });
    };

    return IncidenciaCambio;
};
