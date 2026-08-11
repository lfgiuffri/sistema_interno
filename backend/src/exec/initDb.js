/**
 * Sistema Interno — Provisión de la base de datos (single-tenant).
 *
 * Idempotente: se puede correr todas las veces que haga falta (el entrypoint de Docker lo
 * corre en cada arranque). Hace, en orden:
 *   1. CREATE DATABASE IF NOT EXISTS (conectándose al server sin base).
 *   2. sync() de todos los modelos (crea tablas nuevas; no altera existentes).
 *   3. Seeds condicionales: rol Administrador (isSystem, capability `*`) + usuario admin.
 *
 * Uso: npm run init_db
 * Credenciales del admin inicial por entorno: ADMINUSER / ADMINPASS / ADMIN_EMAIL.
 */

import 'dotenv/config';
import { Sequelize } from 'sequelize';
import { db, initDatabase } from '../database.js';
import { hashPassword } from '../kernel/auth/password.js';

const DB_NAME = process.env.DB_NAME || process.env.MASTER_DBNAME || 'sistema_interno';
const DB_USER = process.env.DB_USER || process.env.MASTER_DBUSER;
const DB_PASS = process.env.DB_PASS || process.env.MASTER_DBPASS;
const DB_HOST = process.env.DB_HOST || process.env.MASTER_DBHOST || 'localhost';

const ADMIN_USERNAME = process.env.ADMINUSER || 'admin';
const ADMIN_PASSWORD = process.env.ADMINPASS || 'admin123';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@sistema.local';

/**
 * Crea la base de datos si no existe (conexión efímera al server, sin base).
 * @returns {Promise<void>}
 */
const ensureDatabase = async () => {
    const server = new Sequelize('', DB_USER, DB_PASS, {
        host: DB_HOST,
        dialect: process.env.DBDRIVER || 'mariadb',
        logging: false
    });
    try {
        await server.query(
            `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;`
        );
        console.log(`✅ Base de datos "${DB_NAME}" verificada/creada`);
    } finally {
        await server.close();
    }
};

/**
 * Siembra el rol Administrador (con capability comodín) y el usuario admin inicial.
 * Condicional: no duplica si ya existen.
 * @param {object} models - Modelos de la app.
 * @returns {Promise<void>}
 */
const seed = async (models) => {
    const { Role, RoleCapability, User } = models;

    // Rol Administrador: isSystem (no editable/eliminable) + capability `*` (todo).
    let adminRole = await Role.findOne({ where: { name: 'administrador' } });
    if (!adminRole) {
        adminRole = await Role.create({
            label: 'Administrador',
            name: 'administrador',
            description: 'Acceso total al sistema. No se puede editar ni eliminar.',
            isSystem: true
        });
        console.log('✅ Rol Administrador creado');
    }
    const wildcard = await RoleCapability.findOne({ where: { roleId: adminRole.id, capability: '*' } });
    if (!wildcard) {
        await RoleCapability.create({ roleId: adminRole.id, capability: '*' });
        console.log('✅ Capability comodín (*) asignada al rol Administrador');
    }

    // Catálogos iniciales (mismos datos que el sistema legado). Condicionales: solo si
    // la tabla está vacía, así no re-crean registros renombrados o eliminados a propósito.
    const { Area, FormaFacturacion } = models;
    if (Area && await Area.count({ paranoid: false }) === 0) {
        await Area.bulkCreate([
            { nombre: 'Gerencia', orden: 10 },
            { nombre: 'Administración', orden: 20 },
            { nombre: 'Desarrollo', orden: 30 },
            { nombre: 'Marketing', orden: 40 },
            { nombre: 'Diseño', orden: 50 },
        ]);
        console.log('✅ Áreas iniciales creadas');
    }
    if (FormaFacturacion && await FormaFacturacion.count({ paranoid: false }) === 0) {
        await FormaFacturacion.bulkCreate([
            { nombre: 'SRL' },
            { nombre: 'Monotributo Leo' },
            { nombre: 'Monotributo Santi' },
            { nombre: 'Sucursal' },
        ]);
        console.log('✅ Formas de facturación iniciales creadas');
    }

    // Espacios de trabajo iniciales (mismos del legado — PRD §2).
    const { EspacioTrabajo } = models;
    if (EspacioTrabajo && await EspacioTrabajo.count({ paranoid: false }) === 0) {
        await EspacioTrabajo.bulkCreate([
            { nombre: 'Soporte' },
            { nombre: 'Desarrollo' },
            { nombre: 'FullGlass' },
        ]);
        console.log('✅ Espacios de trabajo iniciales creados');
    }

    // Cuentas de pago iniciales (mismos datos que el sistema legado).
    const { CuentaPago } = models;
    if (CuentaPago && await CuentaPago.count({ paranoid: false }) === 0) {
        await CuentaPago.bulkCreate([
            { nombre: 'SRL', orden: 10 },
            { nombre: 'Leo', orden: 20 },
            { nombre: 'Javi', orden: 30 },
            { nombre: 'Santi', orden: 40 },
            { nombre: 'SRL Sucursal', orden: 50 },
            { nombre: 'Caja', orden: 60 },
            { nombre: 'SRL Negro', orden: 70 },
        ]);
        console.log('✅ Cuentas de pago iniciales creadas');
    }

    // Configuración de negocio inicial (solo si no existe cada clave).
    const { Config } = models;
    if (Config) {
        const configSeeds = [
            { name: 'COTIZACION_DOLAR', value: '1000', description: 'Valor del dólar usado por abonos, cobranzas y el panel.' },
            { name: 'REDONDEO_ABONOS', value: '100', description: 'Múltiplo al que se redondean los precios al actualizarlos.' },
            { name: 'TAREAS_DIAS_POR_VENCER', value: '3', description: 'Días de anticipación para "por vencer" en tareas.' },
        ];
        for (const seed of configSeeds) {
            await Config.findOrCreate({ where: { name: seed.name }, defaults: seed });
        }
        console.log('✅ Configuración de negocio verificada');
    }

    // Usuario admin inicial. El hash se calcula ANTES del create (nunca texto plano).
    const existingAdmin = await User.findOne({ where: { username: ADMIN_USERNAME } });
    if (!existingAdmin) {
        await User.create({
            name: 'Administrador',
            lastName: 'Sistema',
            email: ADMIN_EMAIL,
            username: ADMIN_USERNAME,
            password: await hashPassword(ADMIN_PASSWORD),
            roleId: adminRole.id,
            active: true
        });
        console.log(`✅ Usuario admin creado (${ADMIN_USERNAME}). ⚠️ Cambiá la contraseña al primer ingreso.`);
    }
};

/**
 * Punto de entrada del script de provisión.
 * @returns {Promise<void>}
 */
const main = async () => {
    if (!DB_USER) {
        console.error('❌ Falta DB_USER (o MASTER_DBUSER) en el entorno.');
        process.exit(1);
    }

    await ensureDatabase();

    const { models } = await initDatabase();

    // sync() crea las tablas que falten según los modelos (no altera las existentes:
    // para deltas sobre una base con datos están las migraciones).
    await db.sync();
    console.log('✅ Schema sincronizado');

    await seed(models);

    await db.close();
    console.log('🏁 Provisión completa');
};

main().catch((err) => {
    console.error('❌ Error en la provisión:', err.message);
    process.exit(1);
});
