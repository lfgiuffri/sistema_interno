import { DataTypes } from 'sequelize';

/**
 * ErrorLog — registra automáticamente cualquier respuesta de error (success === false)
 * generada por responseManager. Antes se llamaba NotificationLog y mezclaba logging
 * con envío de notificaciones; ahora es solo log de errores.
 *
 * Columnas en TEXT/LONGTEXT para no truncar headers, bodies o stack traces grandes.
 */
export const defineErrorLogModel = (tenantDb) => {
    const ErrorLog = tenantDb.define('errorLog', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        ip: { type: DataTypes.STRING, allowNull: true },
        method: { type: DataTypes.STRING(10), allowNull: true },
        url: { type: DataTypes.TEXT, allowNull: true },
        header: { type: DataTypes.TEXT('long'), allowNull: true },
        body: { type: DataTypes.TEXT('long'), allowNull: true },
        userId: { type: DataTypes.INTEGER, allowNull: true },
        code: { type: DataTypes.INTEGER, allowNull: true },
        error: { type: DataTypes.STRING(100), allowNull: true },
        message: { type: DataTypes.TEXT('long'), allowNull: true },
        stack: { type: DataTypes.TEXT('long'), allowNull: true },
        response: { type: DataTypes.TEXT('long'), allowNull: true }
    }, {
        tableName: 'errorLogs',
        timestamps: true
    });

    ErrorLog.associate = (models) => {
        if (models.User) ErrorLog.belongsTo(models.User, { foreignKey: 'userId' });
    };

    return ErrorLog;
};
