import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";
import express from "express";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { readdir, readFile } from "node:fs/promises";
import multer from "multer";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validatePassword, createAuthService } from "./auth.js";
import { createAuthDatabase, createAuthStore } from "./auth-store.js";
import { loadSupplierPayments } from "./suppliers.js";
import { loadDeliveryReadiness } from "./deliveries.js";
import { loadSalesPerformance } from "./sales.js";
import { createInvoiceAnalyzer } from "./invoice-analysis.js";
import {
  createLocalInvoiceStorage,
  DuplicateInvoiceError,
} from "./invoice-storage.js";

const publicDirectory = path.join(import.meta.dirname, "public");
const invoiceExamplesDirectory = path.join(
  import.meta.dirname,
  "Documentos",
  "Facturas",
);
const emptyMessage = "El asistente no esta disponible en este momento, contacte a su superior.";
const userDeletionRestrictedUsername = "carlos";
const userEditRestrictedUsername = "esdras";
const maxInvoiceSize = 10 * 1024 * 1024;
const allowedInvoiceTypes = new Map([
  [".pdf", "application/pdf"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
]);
const invoiceExampleLabels = new Map([
  ["factura_limpia.pdf", "Factura limpia"],
  ["factura_foto_borrosa.jpg", "Foto borrosa"],
  ["factura_monto_borroso.jpg", "Monto borroso"],
  ["factura_distinta.pdf", "Factura distinta"],
  ["factura_final2.pdf", "Factura final"],
]);

function isValidInvoice(file) {
  const extension = path.extname(path.basename(file.originalname)).toLowerCase();
  const contentType = allowedInvoiceTypes.get(extension);

  if (!contentType || file.mimetype !== contentType) {
    return false;
  }

  if (extension === ".pdf") {
    return file.buffer.subarray(0, 1024).includes(Buffer.from("%PDF-"));
  }

  if (extension === ".png") {
    return file.buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  }

  return (
    file.buffer[0] === 0xff &&
    file.buffer[1] === 0xd8 &&
    file.buffer[2] === 0xff
  );
}

async function loadInvoiceExamples() {
  const fileEntries = await readdir(invoiceExamplesDirectory, {
    withFileTypes: true,
  });
  const examples = [];
  for (const entry of fileEntries) {
    if (!entry.isFile()) {
      continue;
    }

    const fileName = entry.name;
    const extension = path.extname(fileName).toLowerCase();
    if (!allowedInvoiceTypes.has(extension)) {
      continue;
    }
    const label =
      invoiceExampleLabels.get(fileName) ??
      `Factura de ejemplo: ${path.basename(fileName, extension).replace(/[_-]+/g, " ")}`;

    examples.push({
      id: fileName,
      fileName,
      label,
      contentType: allowedInvoiceTypes.get(extension),
    });
  }
  return examples.sort((first, second) =>
    first.label.localeCompare(second.label, "es-MX"),
  );
}

async function readInvoiceExample(exampleId) {
  const example = (await loadInvoiceExamples()).find(
    ({ id }) => id === exampleId,
  );
  if (!example) {
    return null;
  }

  return {
    ...example,
    buffer: await readFile(path.join(invoiceExamplesDirectory, example.fileName)),
  };
}

export function createApp({
  openai,
  agentRef,
  invoiceStorage = null,
  invoiceAnalyzer = null,
  authStore,
  tokenSecret = process.env.AUTH_TOKEN_SECRET,
  supplierPaymentsLoader = loadSupplierPayments,
  deliveryReadinessLoader = loadDeliveryReadiness,
  salesPerformanceLoader = loadSalesPerformance,
  invoiceExamplesLoader = loadInvoiceExamples,
  invoiceExampleReader = readInvoiceExample,
}) {
  const app = express();
  const invoiceUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxInvoiceSize,
      files: 1,
      fields: 0,
      parts: 1,
    },
  }).single("invoice");
  if (!authStore) {
    throw new Error("Se requiere una base de datos de autenticación.");
  }
  const auth = createAuthService({ store: authStore, tokenSecret });

  function requireAuthentication(permission = null) {
    return async (request, response, next) => {
      response.set("Cache-Control", "private, no-store");
      try {
        const user = await auth.authenticate(request);
        if (!user) {
          await authStore.writeAudit({
            username: "No autenticado",
            action: "Acceso denegado",
            detail: request.path,
            ip: request.ip,
          });
          return response.status(401).json({
            detail: "Inicia sesión para continuar.",
          });
        }
        request.authUser = user;
        if (
          user.mustChangePassword &&
          request.path !== "/api/auth/change-password"
        ) {
          return response.status(403).json({
            code: "PASSWORD_CHANGE_REQUIRED",
            detail: "Debes cambiar tu contraseña antes de continuar.",
          });
        }
        if (permission && !user.permissions.includes(permission)) {
          await authStore.writeAudit({
            userId: user.id,
            username: user.username,
            action: "Acceso denegado",
            detail: `${request.method} ${request.path} (${permission})`,
            ip: request.ip,
          });
          return response.status(403).json({
            detail: "No tienes permiso para acceder a este apartado.",
          });
        }
        return next();
      } catch (error) {
        return next(error);
      }
    };
  }

  const requireChatAccess = requireAuthentication("chatbot");
  const requireInvoiceAccess = requireAuthentication("invoices");
  const requireSupplierAccess = requireAuthentication("suppliers");
  const requireDeliveryAccess = requireAuthentication("deliveries");
  const requireSalesAccess = requireAuthentication("sales");
  const requireUserAdmin = requireAuthentication("user_admin");
  const requireRoleAdmin = requireAuthentication("role_admin");
  const requireAuditAccess = requireAuthentication("audit");

  app.use(express.json({ limit: "16kb" }));
  app.use((request, response, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      return next();
    }
    const origin = request.get("origin");
    if (origin) {
      try {
        if (new URL(origin).host !== request.get("host")) {
          return response.status(403).json({
            detail: "La solicitud no proviene de este sitio.",
          });
        }
      } catch {
        return response.status(403).json({
          detail: "El origen de la solicitud no es válido.",
        });
      }
    }
    return next();
  });
  app.use(express.static(publicDirectory, { index: false }));

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.post("/api/auth/login", async (request, response) => {
    response.set("Cache-Control", "private, no-store");
    const username =
      typeof request.body?.username === "string"
        ? request.body.username.trim().toLocaleLowerCase("es-MX")
        : "";
    const password = request.body?.password;
    if (!username || typeof password !== "string" || password.length > 128) {
      return response.status(422).json({
        detail: "Escribe el usuario y la contraseña.",
      });
    }

    try {
      const user = await auth.authenticatePassword(username, password);
      if (!user) {
        await authStore.writeAudit({
          username: username.slice(0, 100) || "Desconocido",
          action: "Inicio de sesión fallido",
          detail: "Credenciales incorrectas o cuenta inactiva.",
          ip: request.ip,
        });
        return response.status(401).json({
          detail: "Usuario o contraseña incorrectos",
        });
      }
      const tokens = await auth.issueSession(user);
      await authStore.recordLogin(user.id);
      await authStore.writeAudit({
        userId: user.id,
        username: user.username,
        action: "Inicio de sesión",
        ip: request.ip,
      });
      auth.setCookies(response, tokens);
      return response.json({ authenticated: true });
    } catch (error) {
      console.error("No se pudo iniciar sesión:", {
        name: error instanceof Error ? error.name : "Error desconocido",
      });
      return response.status(500).json({
        detail: "No se pudo iniciar sesión. Inténtalo más tarde.",
      });
    }
  });

  app.post("/api/auth/guest", async (request, response) => {
    response.set("Cache-Control", "private, no-store");
    try {
      const guest = await authStore.findUserByUsername("invitado");
      if (!guest || guest.status !== "activo" || !guest.isGuest) {
        return response.status(503).json({
          detail: "El acceso de invitado no está disponible.",
        });
      }
      const tokens = await auth.issueSession(guest, true);
      await authStore.recordLogin(guest.id);
      await authStore.writeAudit({
        userId: guest.id,
        username: "Invitado",
        action: "Inicio de sesión como invitado",
        ip: request.ip,
      });
      auth.setCookies(response, tokens);
      return response.json({
        authenticated: true,
        message:
          "Ha iniciado sesión como Invitado. Su acceso está limitado al Asistente Virtual.",
      });
    } catch (error) {
      console.error("No se pudo iniciar la sesión de invitado:", {
        name: error instanceof Error ? error.name : "Error desconocido",
      });
      return response.status(500).json({
        detail: "No se pudo iniciar sesión como invitado.",
      });
    }
  });

  app.get("/api/auth/session", async (request, response, next) => {
    response.set("Cache-Control", "private, no-store");
    try {
      const user = await auth.authenticate(request);
      return response.json(
        user
          ? {
              authenticated: true,
              user: {
                id: user.id,
                name: user.isGuest ? "Invitado" : user.name,
                username: user.username,
                role: user.role,
                permissions: user.permissions,
                mustChangePassword: user.mustChangePassword,
                isGuest: user.isGuest,
              },
            }
          : { authenticated: false },
      );
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/auth/refresh", async (request, response, next) => {
    response.set("Cache-Control", "private, no-store");
    if (!auth.getCookie(request, "rio_claro_refresh")) {
      return response.json({ authenticated: false });
    }
    try {
      const result = await auth.refresh(request);
      if (!result) {
        auth.clearCookies(response);
        return response.status(401).json({
          detail: "La sesión terminó. Inicia sesión de nuevo.",
        });
      }
      auth.setCookies(response, result);
      return response.json({ authenticated: true });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/auth/logout", async (request, response, next) => {
    response.set("Cache-Control", "private, no-store");
    try {
      let user = await auth.authenticate(request);
      const refreshToken = auth.getCookie(request, "rio_claro_refresh");
      const accessToken = auth.getCookie(request, "rio_claro_access");
      if (refreshToken) {
        let payload;
        try {
          payload = await auth.verifyToken(refreshToken, "refresh");
        } catch {
          payload = null;
        }
        if (payload) {
          await authStore.revokeSession(payload.sid);
          user ??= await authStore.findUserById(payload.sub);
        }
      } else if (user && accessToken) {
        let payload;
        try {
          payload = await auth.verifyToken(accessToken, "access");
        } catch {
          payload = null;
        }
        if (payload) {
          await authStore.revokeSession(payload.sid);
        }
      }
      if (user) {
        await authStore.writeAudit({
          userId: user.id,
          username: user.isGuest ? "Invitado" : user.username,
          action: "Cierre de sesión",
          ip: request.ip,
        });
      }
      auth.clearCookies(response);
      return response.json({ authenticated: false });
    } catch (error) {
      return next(error);
    }
  });

  app.post(
    "/api/auth/change-password",
    requireAuthentication(),
    async (request, response, next) => {
      const { currentPassword, newPassword } = request.body ?? {};
      if (request.authUser.isGuest) {
        return response.status(403).json({
          detail: "La cuenta de invitado no puede cambiar contraseñas.",
        });
      }
      if (!validatePassword(newPassword)) {
        return response.status(422).json({
          detail: "La contraseña nueva debe tener entre 12 y 128 caracteres.",
        });
      }
      try {
        if (
          !request.authUser.isGuest &&
          !(await auth.authenticatePassword(
            request.authUser.username,
            currentPassword,
          ))
        ) {
          return response.status(401).json({
            detail: "La contraseña actual es incorrecta.",
          });
        }
        const passwordHash = await auth.hashPassword(newPassword);
        await authStore.changePassword(request.authUser.id, passwordHash);
        const token = auth.getCookie(request, "rio_claro_access");
        const payload = await auth.verifyToken(token, "access");
        await authStore.revokeOtherSessions(
          request.authUser.id,
          payload.sid,
        );
        await authStore.writeAudit({
          userId: request.authUser.id,
          username: request.authUser.isGuest
            ? "Invitado"
            : request.authUser.username,
          action: "Cambio de contraseña",
          ip: request.ip,
        });
        return response.json({ changed: true });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.get("/api/admin/users", requireUserAdmin, async (_request, response) => {
    return response.json({ users: await authStore.listUsers() });
  });

  app.post("/api/admin/users", requireUserAdmin, async (request, response) => {
    const { name, username, email = null, department = null, role } =
      request.body ?? {};
    if (
      typeof name !== "string" ||
      name.trim().length < 2 ||
      name.trim().length > 120 ||
      typeof username !== "string" ||
      !/^[a-z0-9._-]{3,50}$/i.test(username.trim()) ||
      (email !== null &&
        (typeof email !== "string" ||
          email.length > 254 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) ||
      (department !== null &&
        (typeof department !== "string" || department.length > 120)) ||
      typeof role !== "string"
    ) {
      return response.status(422).json({
        detail: "Revisa nombre, usuario, correo, departamento y rol.",
      });
    }

    try {
      const selectedRole = await authStore.getRoleByName(role);
      if (!selectedRole || role === "Invitado") {
        return response.status(422).json({
          detail: "Selecciona un rol válido para una cuenta de personal.",
        });
      }
      if (
        selectedRole.name === "Administrador" &&
        !request.authUser.permissions.includes("role_admin")
      ) {
        return response.status(403).json({
          detail: "Solo un administrador puede asignar el rol Administrador.",
        });
      }
      const temporaryPassword = randomBytes(24).toString("base64url");
      const id = await authStore.createUser({
        name: name.trim(),
        username: username.trim().toLocaleLowerCase("es-MX"),
        email: email?.trim() || null,
        department: department?.trim() || null,
        passwordHash: await auth.hashPassword(temporaryPassword),
        roleId: selectedRole.id,
      });
      await authStore.writeAudit({
        userId: request.authUser.id,
        username: request.authUser.username,
        action: "Creación de usuario",
        detail: `${username.trim()} (${role})`,
        ip: request.ip,
      });
      return response.status(201).json({
        id,
        temporaryPassword,
        mustChangePassword: true,
      });
    } catch (error) {
      if (error?.code === "23505") {
        return response.status(409).json({
          detail: "El usuario o correo ya está registrado.",
        });
      }
      throw error;
    }
  });

  app.patch(
    "/api/admin/users/:userId",
    requireUserAdmin,
    async (request, response) => {
      const { name, username, email, department, role, status } =
        request.body ?? {};
      const values = {};
      if (name !== undefined) {
        if (typeof name !== "string" || name.trim().length < 2 || name.length > 120) {
          return response.status(422).json({ detail: "El nombre no es válido." });
        }
        values.name = name.trim();
      }
      if (username !== undefined) {
        if (typeof username !== "string" || !/^[a-z0-9._-]{3,50}$/i.test(username.trim())) {
          return response.status(422).json({ detail: "El usuario no es válido." });
        }
        values.username = username.trim().toLocaleLowerCase("es-MX");
      }
      if (email !== undefined) {
        if (
          email !== null &&
          (typeof email !== "string" ||
            email.length > 254 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        ) {
          return response.status(422).json({ detail: "El correo no es válido." });
        }
        values.email = email?.trim() || null;
      }
      if (department !== undefined) {
        if (department !== null && (typeof department !== "string" || department.length > 120)) {
          return response.status(422).json({ detail: "El departamento no es válido." });
        }
        values.department = department?.trim() || null;
      }
      if (role !== undefined) {
        const selectedRole =
          typeof role === "string" ? await authStore.getRoleByName(role) : null;
        if (!selectedRole || role === "Invitado") {
          return response.status(422).json({ detail: "Selecciona un rol válido." });
        }
        if (
          selectedRole.name === "Administrador" &&
          !request.authUser.permissions.includes("role_admin")
        ) {
          return response.status(403).json({
            detail: "Solo un administrador puede asignar el rol Administrador.",
          });
        }
        values.roleId = selectedRole.id;
      }
      if (status !== undefined) {
        if (!["activo", "inactivo"].includes(status)) {
          return response.status(422).json({ detail: "El estado no es válido." });
        }
        values.status = status;
      }

      const existing = await authStore.findUserById(request.params.userId);
      if (!existing || existing.isGuest) {
        return response.status(404).json({ detail: "No se encontró el usuario." });
      }
      if (
        request.authUser.username.toLocaleLowerCase("es-MX") ===
          userDeletionRestrictedUsername &&
        existing.username.toLocaleLowerCase("es-MX") ===
          userEditRestrictedUsername
      ) {
        await authStore.writeAudit({
          userId: request.authUser.id,
          username: request.authUser.username,
          action: "Acceso denegado",
          detail: "Intento de modificar el usuario protegido de Esdras.",
          ip: request.ip,
        });
        return response.status(403).json({
          detail: "No tienes permiso para modificar al usuario Esdras.",
        });
      }
      if (
        existing.username.toLocaleLowerCase("es-MX") ===
          userDeletionRestrictedUsername &&
        values.username !== undefined &&
        values.username.toLocaleLowerCase("es-MX") !==
          existing.username.toLocaleLowerCase("es-MX")
      ) {
        await authStore.writeAudit({
          userId: request.authUser.id,
          username: request.authUser.username,
          action: "Acceso denegado",
          detail: "Intento de cambiar el usuario protegido de Carlos.",
          ip: request.ip,
        });
        return response.status(403).json({
          detail: "No puedes cambiar el nombre de usuario protegido de Carlos.",
        });
      }
      const roleName =
        values.roleId === undefined
          ? existing.role
          : (await authStore.getRoleByName(role)).name;
      const remainsAdmin = roleName === "Administrador" &&
        (values.status ?? existing.status) === "activo";
      if (
        existing.role === "Administrador" &&
        existing.status === "activo" &&
        !remainsAdmin &&
        (await authStore.countActiveAdministrators()) <= 1
      ) {
        return response.status(409).json({
          detail: "No se puede desactivar ni quitar el rol del último administrador activo.",
        });
      }

      try {
        const updated = await authStore.updateUser(request.params.userId, values);
        if (!updated) {
          return response.status(404).json({ detail: "No se encontró el usuario." });
        }
        if (values.status !== undefined || values.roleId !== undefined) {
          await authStore.revokeUserSessions(request.params.userId);
        }
        await authStore.writeAudit({
          userId: request.authUser.id,
          username: request.authUser.username,
          action: "Modificación de usuario",
          detail: `${existing.username}: ${Object.keys(values).join(", ")}`,
          ip: request.ip,
        });
        return response.json({ updated: true });
      } catch (error) {
        if (error?.code === "23505") {
          return response.status(409).json({
            detail: "El usuario o correo ya está registrado.",
          });
        }
        throw error;
      }
    },
  );

  app.delete(
    "/api/admin/users/:userId",
    requireUserAdmin,
    async (request, response) => {
      if (
        request.authUser.username.toLocaleLowerCase("es-MX") ===
        userDeletionRestrictedUsername
      ) {
        await authStore.writeAudit({
          userId: request.authUser.id,
          username: request.authUser.username,
          action: "Acceso denegado",
          detail: "Intento de eliminar un usuario.",
          ip: request.ip,
        });
        return response.status(403).json({
          detail: "No tienes permiso para eliminar usuarios.",
        });
      }
      const existing = await authStore.findUserById(request.params.userId);
      if (!existing || existing.isGuest) {
        return response.status(404).json({ detail: "No se encontró el usuario." });
      }
      if (
        existing.role === "Administrador" &&
        existing.status === "activo" &&
        (await authStore.countActiveAdministrators()) <= 1
      ) {
        return response.status(409).json({
          detail: "No se puede eliminar al último administrador activo.",
        });
      }
      await authStore.writeAudit({
        userId: request.authUser.id,
        username: request.authUser.username,
        action: "Eliminación de usuario",
        detail: existing.username,
        ip: request.ip,
      });
      await authStore.deleteUser(request.params.userId);
      return response.json({ deleted: true });
    },
  );

  app.post(
    "/api/admin/users/:userId/reset-password",
    requireUserAdmin,
    async (request, response) => {
      const user = await authStore.findUserById(request.params.userId);
      if (!user || user.isGuest) {
        return response.status(404).json({ detail: "No se encontró el usuario." });
      }
      if (
        request.authUser.username.toLocaleLowerCase("es-MX") ===
          userDeletionRestrictedUsername &&
        user.username.toLocaleLowerCase("es-MX") ===
          userEditRestrictedUsername
      ) {
        await authStore.writeAudit({
          userId: request.authUser.id,
          username: request.authUser.username,
          action: "Acceso denegado",
          detail: "Intento de restablecer la contraseña de Esdras.",
          ip: request.ip,
        });
        return response.status(403).json({
          detail: "No tienes permiso para restablecer la contraseña de Esdras.",
        });
      }
      const temporaryPassword = randomBytes(24).toString("base64url");
      await authStore.setUserPassword(
        user.id,
        await auth.hashPassword(temporaryPassword),
      );
      await authStore.writeAudit({
        userId: request.authUser.id,
        username: request.authUser.username,
        action: "Restablecimiento de contraseña",
        detail: user.username,
        ip: request.ip,
      });
      return response.json({ temporaryPassword, mustChangePassword: true });
    },
  );

  app.get("/api/admin/roles", requireUserAdmin, async (_request, response) => {
    return response.json({ roles: await authStore.listRoles() });
  });

  app.put(
    "/api/admin/roles/:roleId/permissions",
    requireRoleAdmin,
    async (request, response) => {
      const allowedPermissions = new Set([
        "chatbot",
        "invoices",
        "suppliers",
        "deliveries",
        "sales",
      ]);
      const permissions = request.body?.permissions;
      if (
        !Array.isArray(permissions) ||
        permissions.some(
          (permission) =>
            typeof permission !== "string" ||
            !allowedPermissions.has(permission),
        )
      ) {
        return response.status(422).json({
          detail: "La lista de permisos contiene valores no válidos.",
        });
      }
      const role = (await authStore.listRoles()).find(
        ({ id }) => id === request.params.roleId,
      );
      if (!role || role.name === "Administrador" || role.name === "Invitado") {
        return response.status(403).json({
          detail: "Los permisos de Administrador e Invitado no se pueden editar.",
        });
      }
      await authStore.updateRolePermissions(
        role.id,
        [...new Set(permissions)],
      );
      await authStore.writeAudit({
        userId: request.authUser.id,
        username: request.authUser.username,
        action: "Cambio de permisos",
        detail: `${role.name}: ${[...new Set(permissions)].join(", ")}`,
        ip: request.ip,
      });
      return response.json({ updated: true });
    },
  );

  app.get("/api/admin/audit", requireAuditAccess, async (request, response) => {
    const limit = Number.parseInt(request.query.limit, 10);
    return response.json({
      entries: await authStore.listAudit(
        Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 200) : 100,
      ),
    });
  });

  app.get("/api/invoices/config", requireInvoiceAccess, (_request, response) => {
    response.json({
      enabled: Boolean(invoiceStorage),
      galleryEnabled: true,
      analysisEnabled: Boolean(invoiceAnalyzer),
    });
  });

  app.get("/api/invoices/samples", requireInvoiceAccess, async (request, response) => {

    try {
      return response.json({ records: await invoiceExamplesLoader() });
    } catch (error) {
      console.error("No se pudieron leer los ejemplos de facturas:", {
        name: error instanceof Error ? error.name : "Error desconocido",
      });
      return response.status(500).json({
        detail: "No se pudieron consultar los ejemplos de facturas.",
      });
    }
  });

  app.get("/api/invoices/samples/:sampleId", requireInvoiceAccess, async (request, response) => {

    try {
      const example = await invoiceExampleReader(request.params.sampleId);
      if (!example) {
        return response.status(404).json({
          detail: "No se encontró el ejemplo de factura solicitado.",
        });
      }
      return response
        .set("Cache-Control", "private, no-store")
        .type(example.contentType)
        .set(
          "Content-Disposition",
          `inline; filename="${path.basename(example.fileName)}"`,
        )
        .send(example.buffer);
    } catch (error) {
      console.error("No se pudo leer el ejemplo de factura:", {
        name: error instanceof Error ? error.name : "Error desconocido",
      });
      return response.status(500).json({
        detail: "No se pudo abrir el ejemplo de factura.",
      });
    }
  });

  app.get("/api/invoices", requireInvoiceAccess, async (request, response) => {
    if (!invoiceStorage) {
      return response.status(503).json({
        detail: "La consulta de facturas guardadas no está configurada.",
      });
    }

    try {
      return response.json({ records: await invoiceStorage.listInvoices() });
    } catch (error) {
      console.error("No se pudo consultar la lista privada de facturas:", {
        name: error instanceof Error ? error.name : "Error desconocido",
        code: error?.code,
        statusCode: error?.statusCode,
      });
      return response.status(502).json({
        detail: "No se pudo consultar la lista de facturas guardadas.",
      });
    }
  });

  app.get("/api/invoices/:invoiceId/file", requireInvoiceAccess, async (request, response) => {
    if (!invoiceStorage) {
      return response.status(503).json({
        detail: "La consulta de facturas guardadas no está configurada.",
      });
    }

    try {
      const invoice = await invoiceStorage.readInvoice(request.params.invoiceId);
      if (!invoice) {
        return response.status(404).json({
          detail: "No se encontró la factura solicitada.",
        });
      }
      return response
        .set("Cache-Control", "private, no-store")
        .type(invoice.contentType)
        .set("Content-Disposition", "inline")
        .send(invoice.buffer);
    } catch (error) {
      console.error("No se pudo leer una factura guardada:", {
        name: error instanceof Error ? error.name : "Error desconocido",
        code: error?.code,
        statusCode: error?.statusCode,
      });
      return response.status(502).json({
        detail: "No se pudo abrir la factura guardada.",
      });
    }
  });

  app.post("/api/invoices/samples/:sampleId/analyze", requireInvoiceAccess, async (request, response) => {
    if (!invoiceAnalyzer) {
      return response.status(503).json({
        detail: "La extracción de datos no está configurada.",
      });
    }

    try {
      const example = await invoiceExampleReader(request.params.sampleId);
      if (!example) {
        return response.status(404).json({
          detail: "No se encontró el ejemplo de factura solicitado.",
        });
      }
      return response.json(
        await invoiceAnalyzer({
          buffer: example.buffer,
          contentType: example.contentType,
        }),
      );
    } catch (error) {
      console.error("No se pudo analizar un ejemplo de factura:", {
        name: error instanceof Error ? error.name : "Error desconocido",
        statusCode: error?.statusCode,
      });
      return response.status(502).json({
        detail: "No se pudo extraer y validar la factura. Inténtalo más tarde.",
      });
    }
  });

  app.post("/api/invoices/:invoiceId/analyze", requireInvoiceAccess, async (request, response) => {
    if (!invoiceStorage) {
      return response.status(503).json({
        detail: "El análisis de facturas guardadas no está configurado.",
      });
    }
    if (!invoiceAnalyzer) {
      return response.status(503).json({
        detail: "La extracción de datos no está configurada.",
      });
    }

    try {
      const invoice = await invoiceStorage.readInvoice(request.params.invoiceId);
      if (!invoice) {
        return response.status(404).json({
          detail: "No se encontró la factura solicitada.",
        });
      }
      return response.json(
        await invoiceAnalyzer({
          buffer: invoice.buffer,
          contentType: invoice.contentType,
        }),
      );
    } catch (error) {
      console.error("No se pudo analizar una factura guardada:", {
        name: error instanceof Error ? error.name : "Error desconocido",
        statusCode: error?.statusCode,
      });
      return response.status(502).json({
        detail: "No se pudo extraer y validar la factura. Inténtalo más tarde.",
      });
    }
  });

  app.get("/api/suppliers/config", requireSupplierAccess, (_request, response) => {
    response.json({
      enabled: true,
    });
  });

  app.get("/api/suppliers", requireSupplierAccess, async (request, response) => {


    try {
      return response.json(await supplierPaymentsLoader());
    } catch (error) {
      console.error("No se pudo leer el registro de proveedores:", {
        name: error instanceof Error ? error.name : "Error desconocido",
      });
      return response.status(500).json({
        detail: "No se pudo consultar el registro de proveedores.",
      });
    }
  });

  app.get("/api/deliveries/config", requireDeliveryAccess, (_request, response) => {
    response.json({
      enabled: true,
    });
  });

  app.get("/api/deliveries", requireDeliveryAccess, async (request, response) => {


    try {
      return response.json(await deliveryReadinessLoader());
    } catch (error) {
      console.error("No se pudo calcular la disponibilidad de entregas:", {
        name: error instanceof Error ? error.name : "Error desconocido",
      });
      return response.status(500).json({
        detail: "No se pudo consultar la disponibilidad de entregas.",
      });
    }
  });

  app.get("/api/sales/config", requireSalesAccess, (_request, response) => {
    response.json({
      enabled: true,
    });
  });

  app.get("/api/sales", requireSalesAccess, async (request, response) => {


    try {
      return response.json(await salesPerformanceLoader());
    } catch (error) {
      console.error("No se pudo calcular el reporte de ventas:", {
        name: error instanceof Error ? error.name : "Error desconocido",
      });
      return response.status(500).json({
        detail: "No se pudo consultar el reporte de ventas.",
      });
    }
  });

  app.post(
    "/api/invoices",
    requireInvoiceAccess,
    (request, response, next) => {
      if (!invoiceStorage) {
        return response.status(503).json({
          detail: "La carga de facturas no está configurada.",
        });
      }


      return invoiceUpload(request, response, (error) => {
        if (!error) {
          return next();
        }

        if (error instanceof multer.MulterError) {
          const tooLarge = error.code === "LIMIT_FILE_SIZE";
          return response.status(tooLarge ? 413 : 422).json({
            detail: tooLarge
              ? "La factura no puede superar los 10 MB."
              : "Selecciona un solo archivo de factura.",
          });
        }

        console.error(
          "No se pudo procesar la carga de la factura:",
          error instanceof Error ? error.name : "Error desconocido",
        );
        return response.status(400).json({
          detail: "No se pudo procesar el archivo de factura.",
        });
      });
    },
    async (request, response) => {
      const file = request.file;
      if (!file || !isValidInvoice(file)) {
        return response.status(422).json({
          detail: "Sube una factura PDF, JPG o PNG válida.",
        });
      }

      try {
        const extension = path.extname(path.basename(file.originalname)).toLowerCase();
        let analysis = null;
        let analysisError = null;

        if (invoiceAnalyzer) {
          try {
            analysis = await invoiceAnalyzer({
              buffer: file.buffer,
              contentType: file.mimetype,
            });
          } catch (error) {
            console.error("La factura se guardó, pero falló el análisis local:", {
              name: error instanceof Error ? error.name : "Error desconocido",
            });
            analysisError =
              "La factura se guardó correctamente, pero no se pudo analizar. Puedes volver a intentarlo desde la galería.";
          }
        }

        const invoiceId = await invoiceStorage.saveInvoice({
          file,
          extension,
          analysis,
          analyzeInvoice: invoiceAnalyzer,
        });
        return response.status(201).json({
          invoice_id: invoiceId,
          file_name: file.originalname,
          analysis,
          analysis_error: analysisError,
          detail: analysis
            ? "La factura se guardó de forma privada y se analizó."
            : invoiceAnalyzer
              ? "La factura se guardó de forma privada, pero el análisis no finalizó."
              : "La factura se guardó de forma privada; la extracción no está configurada.",
        });
      } catch (error) {
        if (error instanceof DuplicateInvoiceError) {
          return response.status(409).json({
              detail: `Esta factura ya está guardada como "${error.invoice.fileName}". No se guardó una segunda copia.`,
              duplicate: error.invoice,
          });
        }

        console.error("No se pudo guardar la factura:", {
          name: error instanceof Error ? error.name : "Error desconocido",
          code: error?.code,
          statusCode: error?.statusCode,
        });
        return response.status(502).json({
          detail: "No se pudo procesar la factura. Inténtalo más tarde.",
        });
      }
    },
  );

  app.post("/api/chat", requireChatAccess, async (request, response) => {
    const { message, conversation_id: conversationId } = request.body ?? {};

    if (typeof message !== "string") {
      return response.status(422).json({
        detail: "El mensaje debe ser texto de 1 a 2000 caracteres.",
      });
    }

    if (message.trim().length === 0) {
      return response.status(422).json({ detail: emptyMessage });
    }

    if (message.length > 2000) {
      return response.status(422).json({
        detail: "El mensaje debe tener entre 1 y 2000 caracteres.",
      });
    }

    if (
      conversationId !== undefined &&
      conversationId !== null &&
      (typeof conversationId !== "string" || conversationId.trim().length === 0)
    ) {
      return response.status(422).json({
        detail: "El identificador de conversacion no es valido.",
      });
    }

    try {
      const conversation = conversationId
        ? conversationId
        : (await openai.conversations.create()).id;
      const result = await openai.responses.create(
        { conversation, input: message.trim() },
        agentRef,
      );
      const reply = result.output_text;

      if (typeof reply !== "string" || reply.trim().length === 0) {
        throw new Error("Foundry devolvio una respuesta vacia.");
      }

      return response.json({
        reply,
        conversation_id: conversation,
      });
    } catch (error) {
      console.error(
        "Fallo la solicitud a Foundry:",
        error instanceof Error ? error.message : "Error desconocido",
      );
      return response.status(502).json({ detail: emptyMessage });
    }
  });

  const protectedPages = new Map([
    ["/asistente", "chatbot"],
    ["/facturas", "invoices"],
    ["/proveedores", "suppliers"],
    ["/entregas", "deliveries"],
    ["/ventas", "sales"],
    ["/administracion/usuarios", "user_admin"],
    ["/configuracion", "settings"],
    ["/auditoria", "audit"],
  ]);
  app.use(async (request, response, next) => {
    if (request.method !== "GET") {
      return next();
    }
    if (
      request.path === "/" ||
      request.path === "/login" ||
      request.path === "/acceso-denegado" ||
      request.path === "/cambiar-contrasena"
    ) {
      response.set("Cache-Control", "no-store");
      return response.sendFile(path.join(publicDirectory, "index.html"));
    }
    const permission = protectedPages.get(request.path);
    if (!permission) {
      return next();
    }
    try {
      const user = await auth.authenticate(request);
      if (!user) {
        return response.redirect(302, "/login");
      }
      if (user.mustChangePassword) {
        return response.redirect(302, "/cambiar-contrasena");
      }
      if (!user.permissions.includes(permission)) {
        await authStore.writeAudit({
          userId: user.id,
          username: user.username,
          action: "Acceso denegado",
          detail: `GET ${request.path} (${permission})`,
          ip: request.ip,
        });
        return response.redirect(302, "/acceso-denegado");
      }
      return response.sendFile(path.join(publicDirectory, "index.html"));
    } catch (error) {
      return next(error);
    }
  });

  app.use((error, _request, response, next) => {
    console.error("Solicitud no procesada:", {
      name: error instanceof Error ? error.name : "Error desconocido",
    });
    if (response.headersSent) {
      return next(error);
    }
    return response.status(500).json({
      detail: "No se pudo completar la solicitud. Inténtalo más tarde.",
    });
  });

  return app;
}

async function startServer() {
  const projectEndpoint = process.env.FOUNDRY_PROJECT_ENDPOINT;
  const agentName = process.env.FOUNDRY_AGENT_NAME;

  if (!projectEndpoint || !agentName) {
    throw new Error("Configura FOUNDRY_PROJECT_ENDPOINT y FOUNDRY_AGENT_NAME.");
  }
  if (
    typeof process.env.AUTH_TOKEN_SECRET !== "string" ||
    Buffer.byteLength(process.env.AUTH_TOKEN_SECRET) < 32
  ) {
    throw new Error("AUTH_TOKEN_SECRET debe tener al menos 32 caracteres.");
  }

  const credential = new DefaultAzureCredential();
  const projectClient = new AIProjectClient(projectEndpoint, credential);
  const openai = projectClient.getOpenAIClient();
  const invoiceStorageDirectory =
    process.env.INVOICE_STORAGE_DIRECTORY ||
    path.join(process.env.HOME || homedir(), ".rio-claro", "invoices");
  const invoiceStorage = createLocalInvoiceStorage(invoiceStorageDirectory);
  const invoiceAnalyzer = createInvoiceAnalyzer();
  const authDatabase = createAuthDatabase();
  const authStore = createAuthStore(authDatabase);
  try {
    await authStore.initialize();
    if ((await authStore.countAdministrators()) === 0) {
      throw new Error(
        "No hay una cuenta administradora inicializada. Ejecuta npm run setup-access.",
      );
    }
  } catch (error) {
    authDatabase.close();
    throw error;
  }

  const agentRef = {
    body: {
      agent_reference: {
        name: agentName,
        type: "agent_reference",
      },
    },
  };
  const app = createApp({
    openai,
    agentRef,
    invoiceStorage,
    invoiceAnalyzer,
    authStore,
    tokenSecret: process.env.AUTH_TOKEN_SECRET,
  });
  const port = process.env.PORT || 3000;

  app.listen(port, () => {
    console.log(`Servidor disponible en el puerto ${port}.`);
  });
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  startServer().catch((error) => {
    console.error(
      "No se pudo iniciar el servidor:",
      error instanceof Error ? error.message : "Error desconocido",
    );
    process.exitCode = 1;
  });
}
