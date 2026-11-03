import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import {
  createAuthDatabase,
  createAuthStore,
  defaultUsers,
} from "../auth-store.js";

const database = createAuthDatabase(":memory:");
const store = createAuthStore(database);

after(() => database.close());

test("persists roles, users, sessions, and audit records in SQLite", async () => {
  await store.initialize();
  await store.initialize();

  const roles = await store.listRoles();
  assert.equal(roles.length, 5);
  assert.deepEqual(
    (await store.getRoleByName("Finanzas")).permissions,
    ["chatbot", "invoices", "suppliers"],
  );

  const guest = await store.findUserByUsername("INVITADO");
  assert.equal(guest.isGuest, true);
  assert.equal(guest.mustChangePassword, false);

  const administratorRole = await store.getRoleByName("Administrador");
  const administratorId = await store.createUser({
    name: "Carlos",
    username: defaultUsers.find(({ role }) => role === "Administrador").username,
    passwordHash: "bcrypt-hash",
    roleId: administratorRole.id,
  });
  assert.equal(await store.countAdministrators(), 1);
  assert.equal(await store.countActiveAdministrators(), 1);

  const user = await store.findUserByUsername("CARLOS");
  assert.equal(user.id, administratorId);
  assert.equal(user.passwordHash, "bcrypt-hash");
  assert.equal(user.mustChangePassword, true);

  assert.equal(await store.updateUser(administratorId, { status: "inactivo" }), true);
  assert.equal(await store.countActiveAdministrators(), 0);
  assert.equal(await store.changePassword(administratorId, "new-bcrypt-hash"), false);
  assert.equal(await store.updateUser(administratorId, { status: "activo" }), true);

  const sessionId = "session-test";
  await store.createSession({
    id: sessionId,
    userId: administratorId,
    refreshJtiHash: "first-hash",
    expiresAt: new Date(Date.now() + 60_000),
    isGuest: false,
  });
  assert.equal((await store.getSession(sessionId)).refreshJtiHash, "first-hash");
  assert.equal(
    await store.rotateSession(
      sessionId,
      "first-hash",
      "second-hash",
      new Date(Date.now() + 120_000),
    ),
    true,
  );
  assert.equal((await store.getSession(sessionId)).refreshJtiHash, "second-hash");
  await store.revokeOtherSessions(administratorId, "another-session");
  assert.ok((await store.getSession(sessionId)).revokedAt);

  assert.equal(
    await store.changePassword(administratorId, "updated-bcrypt-hash"),
    true,
  );
  await store.recordLogin(administratorId);
  await store.writeAudit({
    userId: administratorId,
    username: "carlos",
    action: "login",
    detail: "Inicio de sesión",
    ip: "127.0.0.1",
  });
  const [auditEntry] = await store.listAudit(1);
  assert.equal(auditEntry.username, "carlos");
  assert.equal(auditEntry.action, "login");
  assert.ok((await store.findUserById(administratorId)).lastAccess);

  assert.equal(await store.deleteUser(administratorId), true);
  assert.equal(await store.findUserById(administratorId), null);
  assert.equal((await store.listAudit(1))[0].username, "carlos");
});

test("keeps the local database after closing and reopening it", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "rio-claro-auth-"));
  const databasePath = path.join(directory, "auth.sqlite");
  let firstDatabase;
  let reopenedDatabase;
  try {
    firstDatabase = createAuthDatabase(databasePath);
    const firstStore = createAuthStore(firstDatabase);
    await firstStore.initialize();
    const role = await firstStore.getRoleByName("Finanzas");
    await firstStore.createUser({
      name: "Laura",
      username: "laura",
      passwordHash: "bcrypt-hash",
      roleId: role.id,
    });
    firstDatabase.close();
    firstDatabase = null;
    reopenedDatabase = createAuthDatabase(databasePath);
    const reopenedStore = createAuthStore(reopenedDatabase);
    assert.equal((await reopenedStore.findUserByUsername("laura")).name, "Laura");
  } finally {
    firstDatabase?.close();
    reopenedDatabase?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
