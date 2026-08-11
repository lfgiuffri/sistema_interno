import { DataTypes } from 'sequelize';

// Función para definir el modelo Config para un tenant específico
export const defineConfigModel = (tenantDb) => {
    const Config = tenantDb.define('configs', {
        id: {type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true},
        name: {type: DataTypes.STRING, allowNull: false, unique: true},
        value: {type: DataTypes.TEXT, allowNull: false},
        description: {type: DataTypes.STRING},
        updatable: {type: DataTypes.BOOLEAN, defaultValue: true},
    }, {
        timestamps: true,
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
        indexes: [
            {
                unique: true,
                fields: ['name']
            }
        ]
    });

    return Config;
};

// Función para obtener el modelo Config del tenant actual
export const getConfigModel = (req) => {
    if (!req.tenantDb) {
        throw new Error('TenantDb no encontrado en el request');
    }
    return defineConfigModel(req.tenantDb);
};