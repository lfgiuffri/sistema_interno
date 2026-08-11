import { DataTypes } from 'sequelize';

// Función para definir el modelo ActionTracking para un tenant específico
export const defineActionTrackingModel = (tenantDb) => {
    const ActionTracking = tenantDb.define('actionTracking', {
        id: {type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true},
        ip: {type: DataTypes.STRING},
        method: {type: DataTypes.STRING},
        url: {type: DataTypes.STRING},
        header: {type: DataTypes.TEXT},
        body: {type: DataTypes.TEXT},
        userId: {type: DataTypes.INTEGER, allowNull: true},
        responseStatus: {type: DataTypes.INTEGER},
        responseTime: {type: DataTypes.INTEGER}
    }, {
        timestamps: true,
        createdAt: 'createdAt',
        updatedAt: 'updatedAt'
    });

    // Definir asociaciones del modelo ActionTracking
    ActionTracking.associate = (models) => {
        ActionTracking.belongsTo(models.User, { foreignKey: 'userId' });
    };

    return ActionTracking;
};

// Función para obtener el modelo ActionTracking del tenant actual
export const getActionTrackingModel = (req) => {
    if (!req.tenantDb) {
        throw new Error('TenantDb no encontrado en el request');
    }
    return defineActionTrackingModel(req.tenantDb);
};