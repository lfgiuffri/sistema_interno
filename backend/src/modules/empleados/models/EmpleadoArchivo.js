import { DataTypes } from 'sequelize';

/**
 * Modelo EmpleadoArchivo: archivos adjuntos de la ficha (contratos, DNI, recibos...).
 * El binario vive en disco PRIVADO (`storage/empleados/<empleadoId>/`), nombre
 * `<16hex>_<original saneado>`; se sirve solo con auth, como attachment y con nosniff.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo EmpleadoArchivo.
 */
export const defineEmpleadoArchivoModel = (db) => {
    const EmpleadoArchivo = db.define('empleado_archivos', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        empleadoId: { type: DataTypes.INTEGER, allowNull: false },
        descripcion: { type: DataTypes.STRING(200), allowNull: false },
        // Nombre en disco, dentro de la carpeta del empleado.
        nombre: { type: DataTypes.STRING(220), allowNull: false },
        nombreOriginal: { type: DataTypes.STRING(200), allowNull: false },
        mime: { type: DataTypes.STRING(100), allowNull: false },
        size: { type: DataTypes.INTEGER, allowNull: false },
        userId: { type: DataTypes.INTEGER, allowNull: true }
    }, {
        timestamps: true,
        indexes: [{ fields: ['empleadoId'] }]
    });

    EmpleadoArchivo.associate = (models) => {
        if (models.Empleado) EmpleadoArchivo.belongsTo(models.Empleado, { foreignKey: 'empleadoId' });
        if (models.User) EmpleadoArchivo.belongsTo(models.User, { foreignKey: 'userId' });
    };

    return EmpleadoArchivo;
};
