import { DataTypes } from 'sequelize';

/**
 * Modelo CobranzaEvento: AUDITORÍA de cobranzas (mejora §10.3 del PRD — el legado no
 * tenía rastro: descobrar borraba el historial y eliminar era físico).
 * Bitácora append-only: un renglón por cada creación, edición de monto, movida, cobro,
 * descobro o eliminación, con el detalle y el usuario. No es paranoid a propósito.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo CobranzaEvento.
 */
export const defineCobranzaEventoModel = (db) => {
    const CobranzaEvento = db.define('cobranza_eventos', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        cobranzaId: { type: DataTypes.INTEGER, allowNull: false },
        proyectoId: { type: DataTypes.INTEGER, allowNull: false },
        tipo: {
            type: DataTypes.ENUM('creada', 'monto_editado', 'movida', 'cobrada', 'descobrada', 'eliminada'),
            allowNull: false
        },
        // Detalle legible del evento (ej. "US$ 500 → US$ 700" o "Cobrada $ 600.000 @ 1200").
        detalle: { type: DataTypes.STRING(255), allowNull: true },
        userId: { type: DataTypes.INTEGER, allowNull: true }
    }, {
        timestamps: true,
        updatedAt: false, // bitácora: solo createdAt
        indexes: [
            { fields: ['proyectoId', 'createdAt'] },
            { fields: ['cobranzaId'] }
        ]
    });

    CobranzaEvento.associate = (models) => {
        if (models.Cobranza) CobranzaEvento.belongsTo(models.Cobranza, { foreignKey: 'cobranzaId' });
        if (models.User) CobranzaEvento.belongsTo(models.User, { foreignKey: 'userId' });
    };

    return CobranzaEvento;
};
