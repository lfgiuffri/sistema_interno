import { DataTypes } from 'sequelize';

/**
 * Estados de una incidencia, en el orden en que avanza.
 *
 * Son estados de CARA AL CLIENTE, deliberadamente menos que los de una tarea: el cliente no
 * tiene por qué ver nuestro kanban interno (que una tarea esté «pausada» o «en revisión» es
 * asunto nuestro, para él sigue siendo «la están trabajando»).
 */
export const ESTADOS_INCIDENCIA = ['nueva', 'en_progreso', 'resuelta'];

/**
 * Estados que el cliente considera terminados: van al FONDO de su listado.
 *
 * Hubo un cuarto estado, `cerrada`, que se sacó (2026-09-18): se pisaba con `resuelta`. En el
 * portal las dos iban al fondo y decían lo mismo, así que la única diferencia real era que
 * alguien se acordara de cerrar — y si no se acordaba, todo quedaba en `resuelta` para
 * siempre. Un estado que solo agrega trabajo no es un estado.
 */
export const ESTADOS_TERMINADOS = ['resuelta'];

/**
 * Modelo Incidencia: un reclamo o pedido que carga el cliente desde su portal (o que
 * cargamos nosotros en su nombre desde el sistema interno).
 *
 * `descripcion` es TEXTO PLANO, no HTML. Es lo único de la app que recibe contenido desde
 * internet abierto, así que no hay editor rico ni saneado de HTML que mantener: menos
 * superficie de XSS por una función que nadie pidió.
 *
 * `servicioId` es NULLABLE a propósito = «consulta general». Los servicios elegibles se
 * derivan de los abonos activos y los proyectos del cliente, y un cliente sin nada de eso
 * (los abonos nacen inactivos) se quedaría sin poder reportar nada.
 *
 * `fechaEstimada` se COPIA del vencimiento de la tarea vinculada en vez de leerse por el join.
 * Dos motivos: el portal no tiene por qué recibir el objeto tarea (nombre, espacio y lista son
 * datos internos), y la fecha prometida sobrevive a que la tarea se elimine — se la dijimos al
 * cliente, no se la borramos porque reorganizamos el tablero.
 *
 * `tareaId` es UNIQUE: una incidencia se convierte en UNA tarea. El índice único es también
 * lo que hace barata la propagación de estado (buscar la incidencia por `tareaId`) y lo que
 * impide que el botón «crear tarea» genere dos vínculos si se aprieta dos veces.
 *
 * Autoría en DOS columnas separadas (`creadaPorClienteUsuarioId` / `creadaPorUserId`) y no en
 * una: son dos espacios de identificadores distintos y mezclarlos en una sola columna haría
 * que el id 7 signifique dos personas según el contexto.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo Incidencia.
 */
export const defineIncidenciaModel = (db) => {
    const Incidencia = db.define('incidencias', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        clienteId: { type: DataTypes.INTEGER, allowNull: false },
        // null = «consulta general» (el cliente no tiene servicios derivables, o no aplica).
        servicioId: { type: DataTypes.INTEGER, allowNull: true },
        titulo: { type: DataTypes.STRING(200), allowNull: false },
        descripcion: { type: DataTypes.TEXT, allowNull: true },
        estado: { type: DataTypes.ENUM(...ESTADOS_INCIDENCIA), allowNull: false, defaultValue: 'nueva' },
        /** Cuándo estimamos resolverla. Sale del vencimiento de la tarea vinculada. */
        fechaEstimada: { type: DataTypes.DATEONLY, allowNull: true },
        // Tarea vinculada. Mientras no sea null y la incidencia no esté cerrada, el estado es
        // DERIVADO de la tarea; si es null o está cerrada, es manual.
        tareaId: { type: DataTypes.INTEGER, allowNull: true, unique: true },
        creadaPorClienteUsuarioId: { type: DataTypes.INTEGER, allowNull: true },
        creadaPorUserId: { type: DataTypes.INTEGER, allowNull: true },
        resueltaAt: { type: DataTypes.DATE, allowNull: true }
    }, {
        tableName: 'incidencias',
        timestamps: true,
        paranoid: true,
        indexes: [
            { fields: ['clienteId'] },
            { fields: ['servicioId'] },
            { fields: ['estado'] },
            { fields: ['createdAt'] }
        ]
    });

    Incidencia.associate = (models) => {
        if (models.Cliente) Incidencia.belongsTo(models.Cliente, { foreignKey: 'clienteId' });
        if (models.Servicio) Incidencia.belongsTo(models.Servicio, { foreignKey: 'servicioId' });
        if (models.Tarea) Incidencia.belongsTo(models.Tarea, { foreignKey: 'tareaId' });
        if (models.User) Incidencia.belongsTo(models.User, { foreignKey: 'creadaPorUserId', as: 'creadaPorUsuario' });
        if (models.ClienteUsuario) {
            Incidencia.belongsTo(models.ClienteUsuario, { foreignKey: 'creadaPorClienteUsuarioId', as: 'creadaPorCliente' });
        }
        if (models.IncidenciaArchivo) Incidencia.hasMany(models.IncidenciaArchivo, { foreignKey: 'incidenciaId' });
        if (models.IncidenciaCambio) Incidencia.hasMany(models.IncidenciaCambio, { foreignKey: 'incidenciaId' });
    };

    return Incidencia;
};
