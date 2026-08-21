import { DataTypes } from 'sequelize';

/**
 * Modelo SitioVista: una URL concreta que se chequea dentro de un sitio.
 *
 * Un sitio no siempre es una sola página. Un cliente puede tener la home hecha por nosotros
 * y un `/ecommerce` montado aparte, o un `/blog` de un tercero: **cada vista se chequea por
 * separado y tiene su propio «esto lo administramos nosotros»**, porque exigirle el marcador
 * del footer a algo que no hicimos lo dejaría en `sin_marcador` para siempre.
 *
 * Todo sitio tiene al menos la vista `/` (la crea el alta y la migración se la agrega a los
 * que ya existían): así el caso simple —un sitio, una URL— no cambia para nadie.
 *
 * Lo que NO se parte por vista: el **dominio** y el **certificado**, que son del host y no de
 * la ruta. Se siguen consultando y avisando una vez por sitio.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo SitioVista.
 */
export const defineSitioVistaModel = (db) => {
    const SitioVista = db.define('sitio_vistas', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        sitioId: { type: DataTypes.INTEGER, allowNull: false },
        // Ruta relativa a la URL del sitio. Siempre arranca con `/`; la home es `/`.
        ruta: { type: DataTypes.STRING(190), allowNull: false, defaultValue: '/' },
        // Nombre para mostrar («Tienda», «Panel»). Si no hay, se muestra la ruta.
        nombre: { type: DataTypes.STRING(100), allowNull: true },
        // «Este lo administramos nosotros»: le exigimos el marcador del footer.
        verificaMarcador: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        // Override del id del marcador. NULL = usa el global (config MANTENIMIENTO_MARCADOR_ID).
        // Existe porque un sitio viejo puede llevar todavía el marcador con otro id y no vale
        // la pena redeployarlo solo para monitorearlo.
        marcadorId: { type: DataTypes.STRING(100), allowNull: true },
        estado: { type: DataTypes.ENUM('online', 'sin_marcador', 'offline', 'desconocido'), allowNull: false, defaultValue: 'desconocido' },
        ultimoChequeoAt: { type: DataTypes.DATE, allowNull: true },
        ultimoCodigo: { type: DataTypes.INTEGER, allowNull: true },
        tiempoMs: { type: DataTypes.INTEGER, allowNull: true },
        fallosSeguidos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        // Orden manual en la ficha del sitio (múltiplos de 10, como listas y documentos).
        orden: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }
    }, {
        tableName: 'sitio_vistas',
        timestamps: true,
        paranoid: true,
        indexes: [
            { fields: ['sitioId'] },
            { fields: ['activo'] },
            { fields: ['estado'] }
        ]
    });

    SitioVista.associate = (models) => {
        if (models.SitioWeb) SitioVista.belongsTo(models.SitioWeb, { foreignKey: 'sitioId', as: 'sitio' });
        if (models.SitioChequeo) SitioVista.hasMany(models.SitioChequeo, { foreignKey: 'vistaId' });
    };

    return SitioVista;
};
