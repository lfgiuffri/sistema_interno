/**
 * Sistema Interno — limpieza dura (hard delete) de datos de prueba directo en la BD.
 *
 * Los modelos usan soft-delete (paranoid), así que para tests que necesitan un estado
 * realmente limpio borramos por SQL. Es best-effort: si no hay credenciales de BD o el
 * recurso no se reconoce, no hace nada (los tests deben seguir funcionando con soft-delete).
 *
 * Soporta:
 *   - areas/:id · empleados/:id · ... → DELETE del catálogo (con hijos)
 *   - users/:id               → DELETE FROM users
 *   - users/roles/:id         → DELETE FROM role_capabilities + roles
 */
import dotenv from 'dotenv';
import path from 'path';
import mysql from 'mysql2/promise';

dotenv.config({ path: path.resolve(__dirname, '../../backend/.env') });

const dbConfig = {
  host: process.env.DB_HOST || process.env.MASTER_DBHOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || process.env.MASTER_DBUSER || '',
  password: process.env.DB_PASS || process.env.MASTER_DBPASS || '',
  database: process.env.DB_NAME || process.env.MASTER_DBNAME || 'sistema_interno',
};

function parseCleanupPath(cleanupPath: string): string[] {
  return cleanupPath.split('/').filter(Boolean).map((p) => decodeURIComponent(p));
}

/**
 * Hard-delete de un recurso de prueba por su path lógico. Best-effort: nunca tira.
 * @param cleanupPath - Path del recurso (ej. `items/42`, `users/7`, `users/roles/3`).
 */
export async function hardDeleteByPath(cleanupPath: string): Promise<void> {
  const parts = parseCleanupPath(cleanupPath);
  if (!dbConfig.user) return; // sin credenciales de BD → soft-delete alcanza

  let conn: mysql.Connection | null = null;
  try {
    conn = await mysql.createConnection(dbConfig);

    const catalogTables: Record<string, string> = {
      'areas': 'areas',
      'clientes': 'clientes',
      'servicios': 'servicios',
      'formas-facturacion': 'formas_facturacion',
      'abonos': 'abonos',
      'proyectos': 'proyectos',
      'espacios': 'espacios_trabajo',
      'listas': 'listas',
      'tareas': 'tareas',
      'empleados': 'empleados',
      'cuentas': 'cuentas_pago',
    };
    if (catalogTables[parts[0]] && parts[1] && parts[1] !== 'roles') {
      // Proyectos: primero los hijos (cobranza_eventos + cobranzas tienen FK al proyecto).
      if (parts[0] === 'proyectos') {
        await conn.query('DELETE FROM cobranza_eventos WHERE proyectoId = ?', [Number(parts[1])]);
        await conn.query('DELETE FROM cobranzas WHERE proyectoId = ?', [Number(parts[1])]);
      }
      // Espacios: primero accesos, listas y tareas (FK).
      if (parts[0] === 'espacios') {
        await conn.query('DELETE te FROM tarea_estados te JOIN tareas t ON t.id = te.tareaId WHERE t.espacioId = ?', [Number(parts[1])]);
        await conn.query('DELETE ta FROM tarea_archivos ta JOIN tareas t ON t.id = ta.tareaId WHERE t.espacioId = ?', [Number(parts[1])]);
        await conn.query('DELETE FROM tareas WHERE espacioId = ?', [Number(parts[1])]);
        await conn.query('DELETE FROM listas WHERE espacioId = ?', [Number(parts[1])]);
        await conn.query('DELETE FROM usuario_espacios WHERE espacioId = ?', [Number(parts[1])]);
      }
      if (parts[0] === 'tareas') {
        await conn.query('DELETE FROM tarea_estados WHERE tareaId = ?', [Number(parts[1])]);
        await conn.query('DELETE FROM tarea_archivos WHERE tareaId = ?', [Number(parts[1])]);
      }
      // Empleados: primero todos los hijos (áreas, vacaciones, archivos, sueldos, pagos).
      if (parts[0] === 'empleados') {
        for (const tabla of ['empleado_areas', 'vacacion_asignaciones', 'vacacion_tomas', 'empleado_archivos', 'sueldo_actualizaciones', 'sueldo_pagos']) {
          await conn.query(`DELETE FROM ${tabla} WHERE empleadoId = ?`, [Number(parts[1])]);
        }
      }
      if (parts[0] === 'cuentas') {
        await conn.query('DELETE FROM sueldo_pagos WHERE cuentaId = ?', [Number(parts[1])]);
        await conn.query('DELETE FROM cuenta_disponibles WHERE cuentaId = ?', [Number(parts[1])]);
      }
      await conn.query(`DELETE FROM ${catalogTables[parts[0]]} WHERE id = ?`, [Number(parts[1])]);
    } else if (parts[0] === 'users' && parts[1] === 'roles' && parts[2]) {
      const roleId = Number(parts[2]);
      await conn.query('DELETE FROM role_capabilities WHERE roleId = ?', [roleId]);
      await conn.query('DELETE FROM roles WHERE id = ?', [roleId]);
    } else if (parts[0] === 'users' && parts[1]) {
      await conn.query('DELETE FROM notificaciones WHERE userId = ?', [Number(parts[1])]);
      await conn.query('DELETE FROM usuario_espacios WHERE userId = ?', [Number(parts[1])]);
      await conn.query('UPDATE tareas SET asignadoA = NULL WHERE asignadoA = ?', [Number(parts[1])]);
      await conn.query('DELETE FROM users WHERE id = ?', [Number(parts[1])]);
    }
  } catch {
    // best-effort: un fallo de limpieza no debe romper la suite
  } finally {
    await conn?.end().catch(() => null);
  }
}
