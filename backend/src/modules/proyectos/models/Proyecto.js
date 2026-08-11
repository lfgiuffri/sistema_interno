import { DataTypes } from 'sequelize';

/** Estados del ciclo de vida de un proyecto (mismo orden que el legado; los dos últimos son "cerrados"). */
export const ESTADOS_PROYECTO = ['en_diseno', 'en_desarrollo', 'esperando_cliente', 'finalizado', 'finalizado_incompleto'];

/**
 * Modelo Proyecto: trabajos puntuales de un cliente con presupuesto y cobranzas en cuotas.
 *
 * Reglas del legado (../analisis_app_php/05 §2):
 *  - 5 fechas de ciclo de vida OPCIONALES e independientes (no hay máquina de estados);
 *    solo `fechaEstimadaEntrega` alimenta alertas (ventana 5 días). El estado NO se deriva.
 *  - El servicio del proyecto define su ÁREA en la estadística de facturación.
 *  - El presupuesto (`total`) puede estar en ARS o USD; el tope de cobranzas se evalúa en USD.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo Proyecto.
 */
export const defineProyectoModel = (db) => {
    const Proyecto = db.define('proyectos', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        clienteId: { type: DataTypes.INTEGER, allowNull: false },
        nombre: { type: DataTypes.STRING(200), allowNull: false },
        // Define el área a la que suma la facturación del proyecto (null = "Sin área").
        servicioId: { type: DataTypes.INTEGER, allowNull: true },
        estado: { type: DataTypes.ENUM(...ESTADOS_PROYECTO), allowNull: false, defaultValue: 'en_diseno' },
        moneda: { type: DataTypes.ENUM('ARS', 'USD'), allowNull: false, defaultValue: 'USD' },
        // Presupuesto del proyecto (0 = sin tope de planificación).
        total: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
        fechaConfirmacion: { type: DataTypes.DATEONLY, allowNull: true },
        fechaOnboarding: { type: DataTypes.DATEONLY, allowNull: true },
        fechaAprobacionDiseno: { type: DataTypes.DATEONLY, allowNull: true },
        fechaEstimadaEntrega: { type: DataTypes.DATEONLY, allowNull: true },
        fechaEntrega: { type: DataTypes.DATEONLY, allowNull: true },
        observaciones: { type: DataTypes.TEXT, allowNull: true }
    }, {
        timestamps: true,
        paranoid: true,
        indexes: [
            { fields: ['clienteId'] },
            { fields: ['servicioId'] },
            { fields: ['estado'] },
            { fields: ['fechaEstimadaEntrega'] }
        ]
    });

    Proyecto.associate = (models) => {
        if (models.Cliente) Proyecto.belongsTo(models.Cliente, { foreignKey: 'clienteId' });
        if (models.Servicio) Proyecto.belongsTo(models.Servicio, { foreignKey: 'servicioId' });
        if (models.Cobranza) Proyecto.hasMany(models.Cobranza, { foreignKey: 'proyectoId' });
    };

    return Proyecto;
};
