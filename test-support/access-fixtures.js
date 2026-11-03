import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";

export const testTokenSecret =
  "session-secret-for-tests-only-with-more-than-32-bytes";

const rolePermissions = {
  Administrador: [
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
  Finanzas: ["chatbot", "invoices", "suppliers"],
  Logística: ["chatbot", "deliveries"],
  Comercial: ["chatbot", "sales"],
  Invitado: ["chatbot"],
};

const roleDescriptions = {
  Administrador: "Acceso total al sistema.",
  Finanzas: "Facturas y proveedores.",
  Logística: "Entregas e inventario.",
  Comercial: "Ventas y desempeño.",
  Invitado: "Solo asistente virtual.",
};

export const testCredentials = Object.freeze({
  invoices: { username: "laura", password: "invoice-test-password" },
  suppliers: { username: "laura", password: "invoice-test-password" },
  deliveries: { username: "mariana", password: "delivery-test-password" },
  sales: { username: "tono", password: "sales-test-password" },
});

const users = new Map();
const usersByName = new Map();
const sessions = new Map();
const auditEntries = [];
const ready = Promise.all(
  [
    ["laura", "Laura", "Finanzas", testCredentials.invoices.password, false],
    ["mariana", "Mariana", "Logística", testCredentials.deliveries.password, false],
    ["tono", "Toño", "Comercial", testCredentials.sales.password, false],
    ["carlos", "Carlos", "Administrador", "admin-test-password", false],
    ["invitado", "Invitado", "Invitado", null, false],
    ["temp", "Temporal", "Finanzas", "temporary-test-password", true],
  ].map(async ([username, name, role, password, mustChangePassword]) => {
    const user = {
      id: randomUUID(),
      name,
      username,
      email: null,
      department: null,
      passwordHash: password ? await hash(password, 4) : null,
      status: "activo",
      mustChangePassword,
      isGuest: username === "invitado",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      lastAccess: null,
      roleId: role,
      role,
      permissions: rolePermissions[role],
    };
    users.set(user.id, user);
    usersByName.set(username, user);
  }),
);

function refreshUserRole(user) {
  user.role = user.roleId;
  user.permissions = rolePermissions[user.role] ?? [];
}

export const testAuthStore = {
  async findUserByUsername(username) {
    await ready;
    const user = usersByName.get(username.toLowerCase());
    return user ? { ...user } : null;
  },
  async findUserById(id) {
    await ready;
    const user = users.get(id);
    return user ? { ...user } : null;
  },
  async listRoles() {
    return Object.entries(rolePermissions).map(([name, permissions]) => ({
      id: name,
      name,
      description: roleDescriptions[name],
      permissions,
    }));
  },
  async getRoleByName(name) {
    return rolePermissions[name]
      ? {
          id: name,
          name,
          description: roleDescriptions[name],
          permissions: rolePermissions[name],
        }
      : null;
  },
  async listUsers() {
    await ready;
    return [...users.values()]
      .filter(({ isGuest }) => !isGuest)
      .map(({ passwordHash, ...user }) => user);
  },
  async createUser({
    name,
    username,
    email,
    department,
    passwordHash,
    roleId,
  }) {
    await ready;
    const user = {
      id: randomUUID(),
      name,
      username,
      email,
      department,
      passwordHash,
      status: "activo",
      mustChangePassword: true,
      isGuest: false,
      createdAt: new Date(),
      lastAccess: null,
      roleId,
    };
    refreshUserRole(user);
    users.set(user.id, user);
    usersByName.set(username, user);
    return user.id;
  },
  async updateUser(id, values) {
    await ready;
    const user = users.get(id);
    if (!user || user.isGuest) {
      return false;
    }
    if (values.username && values.username !== user.username) {
      usersByName.delete(user.username);
      usersByName.set(values.username, user);
    }
    Object.assign(user, values);
    if (values.roleId) {
      refreshUserRole(user);
    }
    return true;
  },
  async setUserPassword(id, passwordHash) {
    const user = users.get(id);
    if (!user || user.isGuest) {
      return false;
    }
    user.passwordHash = passwordHash;
    user.mustChangePassword = true;
    await this.revokeUserSessions(id);
    return true;
  },
  async changePassword(id, passwordHash) {
    const user = users.get(id);
    if (!user || user.status !== "activo") {
      return false;
    }
    user.passwordHash = passwordHash;
    user.mustChangePassword = false;
    return true;
  },
  async deleteUser(id) {
    const user = users.get(id);
    if (!user || user.isGuest) {
      return false;
    }
    users.delete(id);
    usersByName.delete(user.username);
    return true;
  },
  async countActiveAdministrators() {
    return [...users.values()].filter(
      ({ role, status, isGuest }) =>
        role === "Administrador" && status === "activo" && !isGuest,
    ).length;
  },
  async createSession(session) {
    sessions.set(session.id, { ...session, revokedAt: null });
  },
  async getSession(id) {
    const session = sessions.get(id);
    return session ? { ...session } : null;
  },
  async rotateSession(id, oldHash, newHash, expiresAt) {
    const session = sessions.get(id);
    if (
      !session ||
      session.revokedAt ||
      session.refreshJtiHash !== oldHash ||
      new Date(session.expiresAt).getTime() <= Date.now()
    ) {
      return false;
    }
    session.refreshJtiHash = newHash;
    session.expiresAt = expiresAt;
    return true;
  },
  async revokeSession(id) {
    const session = sessions.get(id);
    if (session) {
      session.revokedAt = new Date();
    }
  },
  async revokeUserSessions(userId) {
    for (const session of sessions.values()) {
      if (session.userId === userId && !session.revokedAt) {
        session.revokedAt = new Date();
      }
    }
  },
  async revokeOtherSessions(userId, currentSessionId) {
    for (const session of sessions.values()) {
      if (
        session.userId === userId &&
        session.id !== currentSessionId &&
        !session.revokedAt
      ) {
        session.revokedAt = new Date();
      }
    }
  },
  async recordLogin(id) {
    const user = users.get(id);
    if (user) {
      user.lastAccess = new Date();
    }
  },
  async writeAudit(entry) {
    auditEntries.unshift({
      id: auditEntries.length + 1,
      dateTime: new Date(),
      ...entry,
    });
  },
  async listAudit(limit = 100) {
    return auditEntries.slice(0, limit);
  },
  async updateRolePermissions(id, permissions) {
    if (!rolePermissions[id] || id === "Administrador") {
      return false;
    }
    rolePermissions[id] = [...permissions];
    for (const user of users.values()) {
      if (user.roleId === id) {
        refreshUserRole(user);
      }
    }
    return true;
  },
};

export async function loginForUsername(baseUrl, username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    throw new Error(`No se pudo crear la sesión de prueba: ${username}.`);
  }
  const setCookies = response.headers.getSetCookie();
  const cookie = setCookies
    .map((value) => value.split(";", 1)[0])
    .find((value) => value.startsWith("rio_claro_access="));
  if (!cookie) {
    throw new Error(`No se recibió la cookie de prueba: ${username}.`);
  }
  return cookie;
}

export async function loginForSection(baseUrl, section) {
  const credentials = testCredentials[section];
  return loginForUsername(baseUrl, credentials.username, credentials.password);
}
