import { DataTypes } from 'sequelize';

/**
 * Modelo SitioIncidente: problemas abiertos de un sitio (caída, marcador ausente, dominio o
 * certificado por vencer). Misma lógica anti-spam que los incidentes de servidores: se avisa
 * al abrir y al cerrar, y no se repite mientras siga abierto.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo SitioIncidente.
 */
export const defineSitioIncidenteModel = (db) => {
    const SitioIncidente = db.define('sitio_incidentes', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        sitioId: { type: DataTypes.INTEGER, allowNull: false },
        // Vista afectada. NULL para los incidentes que son del SITIO y no de una ruta:
        // dominio y certificado son del host, así que no se parten por vista.
        vistaId: { type: DataTypes.INTEGER, allowNull: true },
        tipo: { type: DataTypes.ENUM('offline', 'sin_marcador', 'dominio', 'tls'), allowNull: false },
        detalle: { type: DataTypes.STRING(255), allowNull: true },
        resueltoAt: { type: DataTypes.DATE, allowNull: true },
        createdAt: { type: DataTypes.DATE, allowNull: false }
    }, {
        tableName: 'sitio_incidentes',
        timestamps: true,
        updatedAt: false,
        indexes: [{ fields: ['sitioId', 'tipo', 'resueltoAt'] }, { fields: ['vistaId', 'tipo', 'resueltoAt'] }]
    });

    SitioIncidente.associate = (models) => {
        if (models.SitioWeb) SitioIncidente.belongsTo(models.SitioWeb, { foreignKey: 'sitioId' });
        if (models.SitioVista) SitioIncidente.belongsTo(models.SitioVista, { foreignKey: 'vistaId', as: 'vista' });
    };

    return SitioIncidente;
};
