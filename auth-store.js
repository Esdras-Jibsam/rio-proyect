import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const defaultDatabasePath = path.join(
  import.meta.dirname,
  "data",
  "rio-claro.sqlite",
);

export function createAuthDatabase(
  databasePath = process.env.AUTH_DATABASE_PATH || defaultDatabasePath,
) {
  if (typeof databasePath !== "string" || databasePath.trim() === "") {
    throw new Error("AUTH_DATABASE_PATH debe ser una ruta de archivo válida.");
  }
  const resolvedPath =
    databasePath === ":memory:"
      ? databasePath
      : path.resolve(import.meta.dirname, databasePath);
  if (resolvedPath !== ":memory:") {
    mkdirSync(path.dirname(resolvedPath), { recursive: true, mode: 0o700 });
  }
  const database = new DatabaseSync(resolvedPath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
  `);
  return database;
}

export const roleDefinitions = Object.freeze([
  {
    name: "Administrador",
    description: "Acceso total al sistema.",
    permissions: [
      "chatbot",
      "invoices",
      "suppliers",
      "deliveries",
      "sales",
      "user_admin",
      "settings",
      "audit",
      "role_admin",
    ],
  },
  {
    name: "Finanzas",
    description: "Asistente virtual, facturas, proveedores y pagos.",
    permissions: ["chatbot", "invoices", "suppliers"],
  },
  {
    name: "Logística",
    description: "Asistente virtual, entregas e inventario.",
    permissions: ["chatbot", "deliveries"],
  },
  {
    name: "Comercial",
    description: "Asistente virtual, ventas y desempeño.",
    permissions: ["chatbot", "sales"],
  },
  {
    name: "Invitado",
    description: "Acceso temporal exclusivo al asistente virtual.",
    permissions: ["chatbot"],
  },
]);

export const defaultUsers = Object.freeze([
  { name: "Laura", username: "laura", role: "Finanzas" },
  { name: "Mariana", username: "mariana", role: "Logística" },
  { name: "Toño", username: "tono", role: "Comercial" },
  {
    name: "Carlos",
    username: "carlos",
    role: "Administrador",
    department: "Soporte y Sistemas",
  },
  {
    name: "Esdras",
    username: "esdras",
    role: "Administrador",
    department: "Administración",
  },
]);

const userColumns = new Map([
  ["name", "nombre"],
  ["username", "usuario"],
  ["email", "correo"],
  ["department", "departamento"],
  ["roleId", "rol_id"],
  ["status", "estado"],
]);

function parsePermissions(role) {
  return { ...role, permissions: JSON.parse(role.permissions) };
}

function mapUser(user) {
  return {
    ...user,
    mustChangePassword: Boolean(user.mustChangePassword),
    isGuest: Boolean(user.isGuest),
  };
}

function mapSession(session) {
  return session
    ? { ...session, isGuest: Boolean(session.isGuest) }
    : null;
}

export function createAuthStore(database) {
  const statement = (sql) => database.prepare(sql);

  return {
    async initialize() {
      database.exec(`
        CREATE TABLE IF NOT EXISTS roles (
          id TEXT PRIMARY KEY,
          nombre_rol TEXT NOT NULL UNIQUE,
          descripcion TEXT NOT NULL,
          permissions TEXT NOT NULL DEFAULT '[]',
          fecha_creacion TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE TABLE IF NOT EXISTS usuarios (
          id TEXT PRIMARY KEY,
          nombre TEXT NOT NULL,
          usuario TEXT NOT NULL,
          correo TEXT,
          departamento TEXT,
          password_hash TEXT,
          rol_id TEXT NOT NULL REFERENCES roles(id),
          estado TEXT NOT NULL DEFAULT 'activo'
            CHECK (estado IN ('activo', 'inactivo')),
          must_change_password INTEGER NOT NULL DEFAULT 1,
          is_guest INTEGER NOT NULL DEFAULT 0,
          fecha_creacion TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          ultimo_acceso TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS usuarios_usuario_lower_unique
          ON usuarios (LOWER(usuario));
        CREATE UNIQUE INDEX IF NOT EXISTS usuarios_correo_lower_unique
          ON usuarios (LOWER(correo)) WHERE correo IS NOT NULL;
        CREATE TABLE IF NOT EXISTS auth_sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
          refresh_jti_hash TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          revoked_at TEXT,
          is_guest INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx
          ON auth_sessions (user_id);
        CREATE TABLE IF NOT EXISTS auditoria (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          usuario_id TEXT REFERENCES usuarios(id) ON DELETE SET NULL,
          usuario TEXT NOT NULL,
          accion TEXT NOT NULL,
          detalle TEXT NOT NULL DEFAULT '',
          ip TEXT,
          fecha_hora TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE INDEX IF NOT EXISTS auditoria_fecha_hora_idx
          ON auditoria (fecha_hora DESC);
      `);

      const insertRole = statement(`
        INSERT INTO roles (id, nombre_rol, descripcion, permissions)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (nombre_rol) DO NOTHING
      `);
      for (const role of roleDefinitions) {
        insertRole.run(
          randomUUID(),
          role.name,
          role.description,
          JSON.stringify(role.permissions),
        );
      }

      statement(`
        INSERT INTO usuarios
          (id, nombre, usuario, rol_id, estado, must_change_password, is_guest)
        SELECT ?, 'Invitado', 'invitado', id, 'activo', 0, 1
        FROM roles
        WHERE nombre_rol = 'Invitado'
          AND NOT EXISTS (
            SELECT 1 FROM usuarios WHERE LOWER(usuario) = 'invitado'
          )
      `).run(randomUUID());
    },

    async listRoles() {
      return statement(`
        SELECT id, nombre_rol AS name, descripcion AS description, permissions
        FROM roles ORDER BY nombre_rol
      `)
        .all()
        .map(parsePermissions);
    },

    async getRoleByName(name) {
      const role = statement(`
        SELECT id, nombre_rol AS name, descripcion AS description, permissions
        FROM roles WHERE nombre_rol = ?
      `).get(name);
      return role ? parsePermissions(role) : null;
    },

    async findUserByUsername(username) {
      const user = statement(`
        SELECT u.id, u.nombre AS name, u.usuario AS username, u.correo AS email,
                u.departamento AS department, u.password_hash AS "passwordHash",
                u.estado AS status, u.must_change_password AS "mustChangePassword",
                u.is_guest AS "isGuest", u.fecha_creacion AS "createdAt",
                u.ultimo_acceso AS "lastAccess", r.id AS "roleId",
                r.nombre_rol AS role, r.permissions
        FROM usuarios u JOIN roles r ON r.id = u.rol_id
        WHERE LOWER(u.usuario) = LOWER(?)
      `).get(username);
      return user ? mapUser(parsePermissions(user)) : null;
    },

    async findUserById(id) {
      const user = statement(`
        SELECT u.id, u.nombre AS name, u.usuario AS username, u.correo AS email,
                u.departamento AS department, u.password_hash AS "passwordHash",
                u.estado AS status, u.must_change_password AS "mustChangePassword",
                u.is_guest AS "isGuest", u.fecha_creacion AS "createdAt",
                u.ultimo_acceso AS "lastAccess", r.id AS "roleId",
                r.nombre_rol AS role, r.permissions
        FROM usuarios u JOIN roles r ON r.id = u.rol_id
        WHERE u.id = ?
      `).get(id);
      return user ? mapUser(parsePermissions(user)) : null;
    },

    async createUser({
      name,
      username,
      email = null,
      department = null,
      passwordHash,
      roleId,
    }) {
      const id = randomUUID();
      statement(`
        INSERT INTO usuarios
          (id, nombre, usuario, correo, departamento, password_hash, rol_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, name, username, email, department, passwordHash, roleId);
      return id;
    },

    async listUsers() {
      return statement(`
        SELECT u.id, u.nombre AS name, u.usuario AS username,
                u.correo AS email, u.departamento AS department,
                u.estado AS status, u.fecha_creacion AS "createdAt",
                u.ultimo_acceso AS "lastAccess",
                u.must_change_password AS "mustChangePassword",
                r.id AS "roleId", r.nombre_rol AS role
        FROM usuarios u JOIN roles r ON r.id = u.rol_id
        WHERE u.is_guest = 0 ORDER BY u.nombre, u.usuario
      `)
        .all()
        .map(mapUser);
    },

    async updateUser(id, values) {
      const entries = Object.entries(values).filter(
        ([key, value]) => userColumns.has(key) && value !== undefined,
      );
      if (entries.length === 0) {
        return false;
      }
      const assignments = entries.map(
        ([key]) => `${userColumns.get(key)} = ?`,
      );
      const result = statement(`
        UPDATE usuarios SET ${assignments.join(", ")}
        WHERE id = ? AND is_guest = 0
      `).run(...entries.map(([, value]) => value), id);
      return result.changes > 0;
    },

    async revokeUserSessions(id) {
      statement(`
        UPDATE auth_sessions
        SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE user_id = ? AND revoked_at IS NULL
      `).run(id);
    },

    async setUserPassword(id, passwordHash) {
      const result = statement(`
        UPDATE usuarios
        SET password_hash = ?, must_change_password = 1
        WHERE id = ? AND is_guest = 0
      `).run(passwordHash, id);
      if (result.changes > 0) {
        await this.revokeUserSessions(id);
      }
      return result.changes > 0;
    },

    async changePassword(id, passwordHash) {
      const result = statement(`
        UPDATE usuarios
        SET password_hash = ?, must_change_password = 0
        WHERE id = ? AND estado = 'activo'
      `).run(passwordHash, id);
      return result.changes > 0;
    },

    async deleteUser(id) {
      const result = statement(`
        DELETE FROM usuarios WHERE id = ? AND is_guest = 0
      `).run(id);
      return result.changes > 0;
    },

    async countActiveAdministrators() {
      return statement(`
        SELECT COUNT(*) AS count
        FROM usuarios u JOIN roles r ON r.id = u.rol_id
        WHERE r.nombre_rol = 'Administrador' AND u.estado = 'activo'
          AND u.is_guest = 0
      `).get().count;
    },

    async getSession(id) {
      return mapSession(
        statement(`
          SELECT id, user_id AS "userId",
                 refresh_jti_hash AS "refreshJtiHash",
                 expires_at AS "expiresAt", revoked_at AS "revokedAt",
                 is_guest AS "isGuest"
          FROM auth_sessions WHERE id = ?
        `).get(id),
      );
    },

    async createSession({ id, userId, refreshJtiHash, expiresAt, isGuest }) {
      statement(`
        INSERT INTO auth_sessions
          (id, user_id, refresh_jti_hash, expires_at, is_guest)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        id,
        userId,
        refreshJtiHash,
        new Date(expiresAt).toISOString(),
        Number(isGuest),
      );
    },

    async rotateSession(id, oldHash, newHash, expiresAt) {
      const result = statement(`
        UPDATE auth_sessions
        SET refresh_jti_hash = ?, expires_at = ?
        WHERE id = ? AND refresh_jti_hash = ? AND revoked_at IS NULL
          AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      `).run(
        newHash,
        new Date(expiresAt).toISOString(),
        id,
        oldHash,
      );
      return result.changes === 1;
    },

    async revokeSession(id) {
      statement(`
        UPDATE auth_sessions
        SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND revoked_at IS NULL
      `).run(id);
    },

    async revokeAllSessions(userId) {
      statement(`
        UPDATE auth_sessions
        SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE user_id = ? AND revoked_at IS NULL
      `).run(userId);
    },

    async revokeOtherSessions(userId, currentSessionId) {
      statement(`
        UPDATE auth_sessions
        SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE user_id = ? AND id <> ? AND revoked_at IS NULL
      `).run(userId, currentSessionId);
    },

    async recordLogin(userId) {
      statement(`
        UPDATE usuarios
        SET ultimo_acceso = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?
      `).run(userId);
    },

    async writeAudit({
      userId = null,
      username,
      action,
      detail = "",
      ip = null,
    }) {
      statement(`
        INSERT INTO auditoria (usuario_id, usuario, accion, detalle, ip)
        VALUES (?, ?, ?, ?, ?)
      `).run(userId, username, action, detail, ip);
    },

    async listAudit(limit = 100) {
      return statement(`
        SELECT id, usuario AS username, accion AS action, detalle AS detail,
               ip, fecha_hora AS "dateTime"
        FROM auditoria ORDER BY fecha_hora DESC LIMIT ?
      `).all(limit);
    },

    async updateRolePermissions(id, permissions) {
      const result = statement(`
        UPDATE roles SET permissions = ?
        WHERE id = ? AND nombre_rol <> 'Administrador'
      `).run(JSON.stringify(permissions), id);
      return result.changes === 1;
    },

    async revokeAllSessionsForUsername(username) {
      statement(`
        UPDATE auth_sessions
        SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE user_id = (
          SELECT id FROM usuarios WHERE LOWER(usuario) = LOWER(?)
        ) AND revoked_at IS NULL
      `).run(username);
    },

    async countAdministrators() {
      return statement(`
        SELECT COUNT(*) AS count
        FROM usuarios u JOIN roles r ON r.id = u.rol_id
        WHERE r.nombre_rol = 'Administrador' AND u.estado = 'activo'
          AND u.is_guest = 0
      `).get().count;
    },
  };
}
