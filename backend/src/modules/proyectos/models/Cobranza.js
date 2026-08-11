import { DataTypes } from 'sequelize';

/**
 * Modelo Cobranza: cuota planificada de un proyecto (SIEMPRE en USD).
 *
 * El peso se calcula al vuelo con la cotización vigente mientras está pendiente, y se
 * CONGELA al cobrar (montoPesos + cotización derivada = pesos/usd). Reglas endurecidas
 * respecto del legado (bugs #3/#4 del análisis): una cuota cobrada NO se mueve ni se
 * edita su monto; para tocarla, primero se descobra (auditado en CobranzaEvento).
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo Cobranza.
 */
export const defineCobranzaModel = (db) => {
    const Cobranza = db.define('cobranzas', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        proyectoId: { type: DataTypes.INTEGER, allowNull: false },
        anio: { type: DataTypes.SMALLINT, allowNull: false },
        mes: { type: DataTypes.TINYINT, allowNull: false },
        // Monto planificado, EN DÓLARES.
        montoUsd: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
        cobrado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        // Congelados al cobrar: peso real ingresado + cotización derivada.
        montoPesos: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
        cotizacion: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
        fechaCobro: { type: DataTypes.DATEONLY, allowNull: true }
    }, {
        timestamps: true,
        // Soft delete (el legado hacía DELETE físico — bug §7.2.4): la auditoría necesita
        // que la fila exista aunque esté eliminada.
        paranoid: true,
        indexes: [
            { fields: ['proyectoId'] },
            { fields: ['anio', 'mes'] },
            { fields: ['cobrado'] }
        ]
    });

    Cobranza.associate = (models) => {
        if (models.Proyecto) Cobranza.belongsTo(models.Proyecto, { foreignKey: 'proyectoId' });
        if (models.CobranzaEvento) Cobranza.hasMany(models.CobranzaEvento, { foreignKey: 'cobranzaId' });
    };

    return Cobranza;
};
