import { DataTypes } from 'sequelize';

/**
 * Modelo Facturacion: historial mensual de lo facturado por abono (montos CONGELADOS).
 *
 * Una fila por (abono, año, mes) VIGENTE. El monto en pesos y la cotización aplicada se
 * congelan al facturar: el histórico no cambia aunque cambie el dólar. La ANULACIÓN es
 * no-destructiva y auditada (anuladaAt/anuladaPor/motivoAnulacion) — el sistema legado no
 * tenía forma de anular una facturación; esta es la mejora §10.2 del PRD. Un período con
 * facturación anulada puede volver a facturarse.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo Facturacion.
 */
export const defineFacturacionModel = (db) => {
    const Facturacion = db.define('facturaciones', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        abonoId: { type: DataTypes.INTEGER, allowNull: false },
        // Redundancia intencional (snapshot): la facturación sobrevive a cambios del abono.
        clienteId: { type: DataTypes.INTEGER, allowNull: false },
        servicioId: { type: DataTypes.INTEGER, allowNull: false },
        anio: { type: DataTypes.SMALLINT, allowNull: false },
        mes: { type: DataTypes.TINYINT, allowNull: false },
        moneda: { type: DataTypes.ENUM('ARS', 'USD'), allowNull: false },
        // Precio del abono al facturar, en su moneda (snapshot).
        precio: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
        // Cotización aplicada (solo si el abono es USD).
        cotizacion: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
        // Total facturado en pesos — CONGELADO.
        montoPesos: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
        // Fecha real de la operación (distinta del período anio/mes).
        fecha: { type: DataTypes.DATEONLY, allowNull: false },
        userId: { type: DataTypes.INTEGER, allowNull: true },
        // ── Anulación auditada (no-destructiva) ──
        anuladaAt: { type: DataTypes.DATE, allowNull: true },
        anuladaPor: { type: DataTypes.INTEGER, allowNull: true },
        motivoAnulacion: { type: DataTypes.STRING(255), allowNull: true },
        // Idempotencia del flujo facturar.
        operationId: { type: DataTypes.STRING(64), allowNull: true }
    }, {
        timestamps: true,
        updatedAt: false, // el registro no se edita: solo se anula (campos de anulación)
        indexes: [
            { fields: ['anio', 'mes'] },
            { fields: ['abonoId', 'anio', 'mes'] },
            { fields: ['servicioId'] },
            { fields: ['clienteId'] }
        ]
    });

    Facturacion.associate = (models) => {
        if (models.Abono) Facturacion.belongsTo(models.Abono, { foreignKey: 'abonoId' });
        if (models.Cliente) Facturacion.belongsTo(models.Cliente, { foreignKey: 'clienteId' });
        if (models.Servicio) Facturacion.belongsTo(models.Servicio, { foreignKey: 'servicioId' });
        if (models.User) Facturacion.belongsTo(models.User, { foreignKey: 'userId' });
    };

    return Facturacion;
};
