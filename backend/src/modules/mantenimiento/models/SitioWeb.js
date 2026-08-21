import { DataTypes } from 'sequelize';

/**
 * Modelo SitioWeb: los sitios de la empresa y sus clientes, con su monitoreo.
 *
 * Disponibilidad: cada 5 minutos se descarga la URL y se busca el marcador
 * `<div id="app-conn-id">` que todos nuestros sitios llevan en el footer. Por eso hay TRES
 * estados y no dos: un sitio puede responder 200 y no tener el marcador (deploy roto o
 * página del hosting), que no es lo mismo que estar caído.
 *
 * Dominio: la fecha se consulta por RDAP una vez por día. Los TLD sin RDAP (.io, .uy, .cl…)
 * quedan con `dominioAuto = false` y la fecha se carga a mano — el estado (ok / por vencer /
 * vencido) se calcula igual en los dos casos.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo SitioWeb.
 */
export const defineSitioWebModel = (db) => {
    const SitioWeb = db.define('sitios_web', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        nombre: { type: DataTypes.STRING(150), allowNull: false },
        url: { type: DataTypes.STRING(255), allowNull: false },
        servicioId: { type: DataTypes.INTEGER, allowNull: true },
        servidorId: { type: DataTypes.INTEGER, allowNull: true },
        activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        // Los sitios que hicimos nosotros llevan el marcador en el footer. Los de terceros
        // (y cualquier cosa que solo queramos ver "que responda") se chequean sin exigirlo:
        // si no, quedarían siempre en `sin_marcador` y el aviso perdería sentido.
        verificaMarcador: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        // Estado de disponibilidad del último chequeo.
        estado: { type: DataTypes.ENUM('online', 'sin_marcador', 'offline', 'desconocido'), allowNull: false, defaultValue: 'desconocido' },
        ultimoChequeoAt: { type: DataTypes.DATE, allowNull: true },
        ultimoCodigo: { type: DataTypes.INTEGER, allowNull: true },
        tiempoMs: { type: DataTypes.INTEGER, allowNull: true },
        // Fallos consecutivos: la alerta espera al segundo para no avisar por un microcorte.
        fallosSeguidos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        // Dominio.
        dominio: { type: DataTypes.STRING(190), allowNull: true },
        dominioVenceAt: { type: DataTypes.DATEONLY, allowNull: true },
        dominioAuto: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        dominioConsultadoAt: { type: DataTypes.DATE, allowNull: true },
        // Certificado TLS (se lee en el handshake del chequeo).
        tlsVenceAt: { type: DataTypes.DATEONLY, allowNull: true },
        observacion: { type: DataTypes.TEXT, allowNull: true }
    }, {
        tableName: 'sitios_web',
        timestamps: true,
        paranoid: true,
        indexes: [{ fields: ['activo'] }, { fields: ['estado'] }, { fields: ['servidorId'] }]
    });

    SitioWeb.associate = (models) => {
        // Alias explícitos: Sequelize singulariza mal los nombres en español
        // (`servidores` → `servidore`) y el frontend necesita claves estables.
        if (models.Servicio) SitioWeb.belongsTo(models.Servicio, { foreignKey: 'servicioId', as: 'servicio' });
        if (models.Servidor) SitioWeb.belongsTo(models.Servidor, { foreignKey: 'servidorId', as: 'servidor' });
        if (models.SitioVista) SitioWeb.hasMany(models.SitioVista, { foreignKey: 'sitioId', as: 'vistas' });
        if (models.SitioChequeo) SitioWeb.hasMany(models.SitioChequeo, { foreignKey: 'sitioId' });
        if (models.SitioIncidente) SitioWeb.hasMany(models.SitioIncidente, { foreignKey: 'sitioId' });
    };

    return SitioWeb;
};
