import { DataTypes } from 'sequelize';

/**
 * Modelo SitioVelocidadDia: resumen diario de velocidad y disponibilidad de una vista.
 *
 * El detalle por chequeo (`sitios_chequeos`) se purga a los 30 días, así que sin este rollup
 * la respuesta a «¿el sitio está más lento que el año pasado?» se perdería para siempre. Una
 * fila por vista y por día pesa nada y **no se purga nunca**: el mes y el año se calculan
 * agregando estas filas, no volviendo al detalle.
 *
 * `disponibilidad` es el porcentaje de chequeos del día que dieron `online`. Va acá y no
 * derivada de otra tabla porque es el mismo dato agregado del mismo lote: separarlas obligaría
 * a leer dos veces lo mismo.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo SitioVelocidadDia.
 */
export const defineSitioVelocidadDiaModel = (db) => {
    const SitioVelocidadDia = db.define('sitio_velocidad_dia', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        sitioId: { type: DataTypes.INTEGER, allowNull: false },
        vistaId: { type: DataTypes.INTEGER, allowNull: false },
        fecha: { type: DataTypes.DATEONLY, allowNull: false },
        muestras: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        // Promedio SOLO de los chequeos que respondieron: un timeout no es «12000 ms de
        // latencia», es una caída, y meterlo en el promedio arruinaría la serie.
        promedioMs: { type: DataTypes.INTEGER, allowNull: true },
        minMs: { type: DataTypes.INTEGER, allowNull: true },
        maxMs: { type: DataTypes.INTEGER, allowNull: true },
        disponibilidad: { type: DataTypes.DECIMAL(5, 2), allowNull: true }
    }, {
        tableName: 'sitio_velocidad_dia',
        timestamps: true,
        // Sin paranoid: es una bitácora agregada, no un dato de negocio que se dé de baja.
        paranoid: false,
        indexes: [
            // Único: el rollup es idempotente (re-correrlo el mismo día actualiza la fila).
            { unique: true, fields: ['vistaId', 'fecha'] },
            { fields: ['sitioId', 'fecha'] }
        ]
    });

    SitioVelocidadDia.associate = (models) => {
        if (models.SitioWeb) SitioVelocidadDia.belongsTo(models.SitioWeb, { foreignKey: 'sitioId', as: 'sitio' });
        if (models.SitioVista) SitioVelocidadDia.belongsTo(models.SitioVista, { foreignKey: 'vistaId', as: 'vista' });
    };

    return SitioVelocidadDia;
};
