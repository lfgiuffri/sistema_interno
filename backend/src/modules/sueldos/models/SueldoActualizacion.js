import { DataTypes } from 'sequelize';

/**
 * Modelo SueldoActualizacion: la FUENTE DE VERDAD del sueldo (PRD §6.5 — el vigente se
 * deriva SIEMPRE de acá con `salarioEnMes`; `empleados.sueldo` es cache sincronizado).
 *
 * Tipos de registro (derivados, no persistidos):
 *  - porcentaje != null → "Ajuste ±N%" (+ "(base mm/aaaa)" si baseMes).
 *  - sueldoAnterior <= 0.5 → "Carga inicial".
 *  - resto → "Edición manual".
 * Desempate del vigente: fecha DESC, id DESC (dos registros el mismo día gana el más nuevo).
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo SueldoActualizacion.
 */
export const defineSueldoActualizacionModel = (db) => {
    const SueldoActualizacion = db.define('sueldo_actualizaciones', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        empleadoId: { type: DataTypes.INTEGER, allowNull: false },
        fecha: { type: DataTypes.DATEONLY, allowNull: false },
        sueldoAnterior: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
        sueldoNuevo: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
        // Solo en ajustes por %: el % aplicado (acepta negativos y decimales).
        porcentaje: { type: DataTypes.DECIMAL(8, 2), allowNull: true },
        // Solo en aumentos programados por %: mes base del cálculo (día 1, informativo).
        baseMes: { type: DataTypes.DATEONLY, allowNull: true },
        userId: { type: DataTypes.INTEGER, allowNull: true }
    }, {
        timestamps: true,
        updatedAt: false, // historial: los registros no se editan (se reemplazan por mes en aumentos)
        indexes: [{ fields: ['empleadoId', 'fecha'] }]
    });

    SueldoActualizacion.associate = (models) => {
        if (models.Empleado) SueldoActualizacion.belongsTo(models.Empleado, { foreignKey: 'empleadoId' });
        if (models.User) SueldoActualizacion.belongsTo(models.User, { foreignKey: 'userId' });
    };

    return SueldoActualizacion;
};
