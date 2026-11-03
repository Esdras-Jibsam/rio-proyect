import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { hash } from "bcryptjs";
import {
  createAuthDatabase,
  createAuthStore,
  defaultUsers,
} from "../auth-store.js";
import { validatePassword } from "../auth.js";
import { assertCredentialOutputAllowed } from "./credential-output.js";

assertCredentialOutputAllowed();

const envPath = path.join(import.meta.dirname, "..", ".env");
const rotateAccess = process.argv.includes("--rotate");
const managedVariables = ["AUTH_TOKEN_SECRET"];
const configuredTokenSecret = process.env.AUTH_TOKEN_SECRET?.trim();
const persistTokenSecret =
  !configuredTokenSecret && !process.env.WEBSITE_SITE_NAME;
let existingEnvironment = "";

try {
  existingEnvironment = await readFile(envPath, "utf8");
} catch (error) {
  if (error?.code !== "ENOENT") {
    throw error;
  }
}

const tokenSecret =
  configuredTokenSecret || randomBytes(48).toString("base64url");
if (persistTokenSecret) {
  const newline = existingEnvironment.includes("\r\n") ? "\r\n" : "\n";
  const lines = existingEnvironment.split(/\r?\n/);
  for (const name of managedVariables) {
    const setting = `${name}=${tokenSecret}`;
    const existingLine = lines.findIndex((line) =>
      new RegExp(`^\\s*${name}\\s*=`).test(line),
    );
    if (existingLine >= 0) {
      lines[existingLine] = setting;
    } else {
      lines.push(setting);
    }
  }
  await writeFile(
    envPath,
    `${lines.join(newline).trimEnd()}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

const database = createAuthDatabase();
const store = createAuthStore(database);

try {
  await store.initialize();
  const credentials = [];
  const existingUsers = await store.listUsers();
  const usernames = new Set(existingUsers.map(({ username }) => username));

  for (const user of defaultUsers) {
    if (usernames.has(user.username)) {
      continue;
    }
    const role = await store.getRoleByName(user.role);
    if (!role) {
      throw new Error(`No se encontró el rol ${user.role}.`);
    }
    const password = randomBytes(24).toString("base64url");
    if (!validatePassword(password)) {
      throw new Error("No se pudo generar una contraseña de inicio válida.");
    }
    await store.createUser({
      name: user.name,
      username: user.username,
      department: user.department ?? null,
      passwordHash: await hash(password, 12),
      roleId: role.id,
    });
    if (!rotateAccess) {
      credentials.push({ ...user, password });
    }
  }

  if (rotateAccess) {
    for (const user of await store.listUsers()) {
      const password = randomBytes(24).toString("base64url");
      await store.setUserPassword(
        user.id,
        await hash(password, 12),
      );
      credentials.push({
        name: user.name,
        username: user.username,
        role: user.role,
        password,
      });
    }
    await store.revokeAllSessionsForUsername("invitado");
  }

  if (credentials.length === 0) {
    console.log("Las cuentas iniciales ya existen; no se modificaron.");
    console.log("Usa npm run reset-access para renovar sus contraseñas.");
  } else {
    console.log(
      `${rotateAccess ? "Contraseñas renovadas" : "Cuentas inicializadas"}. ` +
        "Guarda estas credenciales; no volverán a mostrarse:",
    );
    for (const { name, username, role, password } of credentials) {
      console.log(`${name} (${username}, ${role}): ${password}`);
    }
    console.log("Todas requieren cambio de contraseña en el primer acceso.");
  }
  console.log("Se guardaron hashes bcrypt en la base de datos local.");
  console.log(
    persistTokenSecret
      ? "El secreto JWT se guardó en .env."
      : "El secreto JWT se administra por configuración del entorno.",
  );
} finally {
  database.close();
}
