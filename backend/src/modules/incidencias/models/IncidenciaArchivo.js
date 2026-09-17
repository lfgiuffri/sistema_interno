import { DataTypes } from 'sequelize';

/**
 * Modelo IncidenciaArchivo: adjuntos de una incidencia. Espejo de `TareaArchivo`, con UNA
 * diferencia que no es cosmética.
 *
 * ⚠️ `clienteId` va DESNORMALIZADO acá, además de estar en la incidencia. Es obligatorio, no
 * una optimización: el archivo se sube ANTES de que la incidencia exista (el formulario
 * permite adjuntar y recién después guardar), así que durante esa ventana `incidenciaId` es
 * null y no hay ninguna incidencia contra la cual verificar de quién es el archivo.
 *
 * Sin ese campo, el patrón de ligado de tareas (`WHERE id IN (...) AND tareaId IS NULL`)
 * dejaría que el cliente A se robe el adjunto en vuelo del cliente B mandando ids —que son
 * enteros secuenciales— en `archivoIds`. Entre compañeros de trabajo da igual; entre clientes
 * distintos es una fuga de datos.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo IncidenciaArchivo.
 */
export const defineIncidenciaArchivoModel = (db) => {
    const IncidenciaArchivo = db.define('incidencia_archivos', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        nombre: { type: DataTypes.STRING(60), allowNull: false, unique: true },
        nombreOriginal: { type: DataTypes.STRING(200), allowNull: true },
        tipo: { type: DataTypes.ENUM('imagen', 'archivo'), allowNull: false, defaultValue: 'archivo' },
        mime: { type: DataTypes.STRING(100), allowNull: true },
        size: { type: DataTypes.INTEGER, allowNull: true },
        /** null = todavía no ligado a una incidencia (lo recoge el GC si queda huérfano). */
        incidenciaId: { type: DataTypes.INTEGER, allowNull: true },
        /** De quién es el archivo, SIEMPRE, incluso antes de existir la incidencia. */
        clienteId: { type: DataTypes.INTEGER, allowNull: false },
        /** Quién lo subió: una de las dos, según de qué lado vino. */
        clienteUsuarioId: { type: DataTypes.INTEGER, allowNull: true },
        userId: { type: DataTypes.INTEGER, allowNull: true }
    }, {
        tableName: 'incidencia_archivos',
        timestamps: true,
        indexes: [
            { fields: ['incidenciaId'] },
            { fields: ['clienteId'] },
            { fields: ['createdAt'] }
        ]
    });

    IncidenciaArchivo.associate = (models) => {
        if (models.Incidencia) IncidenciaArchivo.belongsTo(models.Incidencia, { foreignKey: 'incidenciaId' });
        if (models.Cliente) IncidenciaArchivo.belongsTo(models.Cliente, { foreignKey: 'clienteId' });
    };

    return IncidenciaArchivo;
};
