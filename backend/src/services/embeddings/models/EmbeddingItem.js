import { DataTypes } from 'sequelize';

/**
 * Modelo de tenant `EmbeddingItem` — almacena fragmentos de texto indexables con su
 * vector de embedding para búsqueda semántica genérica (generaliza la "semantic memory").
 *
 * Sigue el patrón factory (defineXModel) que el auto-discovery de tenantAssociations
 * espera: exporta `defineEmbeddingItemModel(tenantDb)`, recibe la conexión Sequelize del
 * tenant y devuelve el modelo. El nombre del modelo accesible vía `models` es
 * `EmbeddingItem` (lo que sigue a `define` y precede `Model`).
 *
 * Diseño:
 * - `ownerType`/`ownerId` desacoplan el embedding de la entidad dueña real (ej. una "note",
 *   "task", etc.), de modo que cualquier feature pueda indexar su contenido sin acoplarse
 *   a este servicio. `ownerId` es nullable porque hay textos sueltos sin entidad asociada.
 * - `vector` es JSON nullable: si todavía no hay key de IA para embeddings, se guarda el
 *   contenido con vector=null y se reintenta a futuro (degradación elegante, no rompe).
 *
 * @param {import('sequelize').Sequelize} tenantDb - Conexión Sequelize del tenant.
 * @returns {import('sequelize').ModelStatic<any>} El modelo EmbeddingItem ligado a esa conexión.
 */
export const defineEmbeddingItemModel = (tenantDb) => {
    const EmbeddingItem = tenantDb.define('embedding_items', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        // Dueño del embedding dentro del tenant. Toda query se filtra por userId (aislamiento intra-tenant).
        userId: { type: DataTypes.INTEGER, allowNull: false },
        // Tipo de la entidad dueña del texto (ej. "note", "task"). Permite agrupar/filtrar por origen.
        ownerType: { type: DataTypes.STRING(64), allowNull: false },
        // Id de la entidad dueña, como string para no acoplarse al tipo de PK del origen.
        // Nullable: hay textos sueltos sin entidad asociada (memoria libre del usuario).
        ownerId: { type: DataTypes.STRING(64), allowNull: true },
        // Texto plano que se indexa. Se usa también como fallback de búsqueda por LIKE sin vector.
        content: { type: DataTypes.TEXT, allowNull: false },
        // Vector de embedding (number[]). Nullable: si no hay key de IA, queda null y se reintenta luego.
        vector: { type: DataTypes.JSON, allowNull: true }
    }, {
        timestamps: true,
        paranoid: true, // soft-delete: nunca se borra físico (convención Zero).
        indexes: [
            // Acelera el acceso más común: traer los embeddings de un usuario filtrando por tipo de dueño.
            { fields: ['userId', 'ownerType'] }
        ]
    });

    /**
     * Declara las relaciones del modelo una vez que todos los modelos del tenant existen.
     * @param {Record<string, import('sequelize').ModelStatic<any>>} models - Mapa de modelos del tenant.
     * @returns {void}
     */
    EmbeddingItem.associate = (models) => {
        // Un EmbeddingItem pertenece a un User (si el modelo User está presente en el tenant).
        // Guard con if(models.User) porque el tenant podría no tener ese modelo cargado.
        if (models.User) {
            EmbeddingItem.belongsTo(models.User, { foreignKey: 'userId' });
        }
    };

    return EmbeddingItem;
};
