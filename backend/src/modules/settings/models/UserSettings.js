import { DataTypes } from 'sequelize';

export const defineUserSettingsModel = (tenantDb) => {
    const UserSettings = tenantDb.define('userSettings', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        pushEnabled: { type: DataTypes.BOOLEAN, defaultValue: true },
        pushToken: { type: DataTypes.STRING(500), allowNull: true },
        quietHoursStart: { type: DataTypes.STRING(5), allowNull: true },
        quietHoursEnd: { type: DataTypes.STRING(5), allowNull: true },
        doNotDisturbEnabled: { type: DataTypes.BOOLEAN, defaultValue: false },
        messageRetentionDays: { type: DataTypes.INTEGER, defaultValue: 0 },
        dollarDefaultCasa: { type: DataTypes.STRING(20), defaultValue: 'blue' },
        euroDefaultCasa:   { type: DataTypes.STRING(20), defaultValue: 'oficial' },
        onboardingCompleted: { type: DataTypes.BOOLEAN, defaultValue: false },
        onboardingStep: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
        onboardingMeta: { type: DataTypes.JSON, allowNull: true, defaultValue: null },
        // Token por-usuario para ingesta automática de gastos (mail/notificaciones). Secreto.
        ingestToken: { type: DataTypes.STRING(64), allowNull: true, defaultValue: null },
        userId: { type: DataTypes.INTEGER, allowNull: false }
    }, {
        paranoid: true,
        timestamps: true,
        indexes: [
            {
                unique: true,
                fields: ['userId', 'deletedAt']
            }
        ]
    });

    UserSettings.associate = (models) => {
        UserSettings.belongsTo(models.User, { foreignKey: 'userId' });
    };

    return UserSettings;
};
