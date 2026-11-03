import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApp } from "../server.js";
import {
  loginForSection,
  loginForUsername,
  testAuthStore,
  testTokenSecret,
} from "../test-support/access-fixtures.js";

const calls = [];
const savedInvoices = [];
const analyzedInvoices = [];
let supplierPaymentsRequests = 0;
let deliveryReadinessRequests = 0;
let salesPerformanceRequests = 0;
let server;
let baseUrl;
const accessCookies = {};

const openai = {
  conversations: {
    create: async () => ({ id: "conversation-test-1" }),
  },
  responses: {
    create: async (request, options) => {
      calls.push({ request, options });
      if (request.input === "trigger-foundry-error") {
        throw new Error("simulated Foundry failure");
      }
      if (request.input === "empty-foundry-response") {
        return { output_text: " " };
      }
      return { output_text: `Respuesta a: ${request.input}` };
    },
  },
};

const agentRef = {
  body: {
    agent_reference: {
      name: "rio-proyect",
      type: "agent_reference",
    },
  },
};

const invoiceStorage = {
  async saveInvoice({ file, extension }) {
    savedInvoices.push({ file, extension });
    return `invoice-test-${savedInvoices.length}`;
  },
  async listInvoices() {
    return [
      {
        id: "00000000-0000-4000-8000-000000000001.pdf",
        fileName: "factura guardada.pdf",
        contentType: "application/pdf",
        createdAt: "2026-11-02T12:00:00.000Z",
      },
    ];
  },
  async readInvoice(invoiceId) {
    if (invoiceId !== "00000000-0000-4000-8000-000000000001.pdf") {
      return null;
    }
    return {
      buffer: Buffer.from("%PDF-1.7\nfactura de prueba"),
      contentType: "application/pdf",
    };
  },
};

const invoiceAnalysis = {
  model: "prebuilt-invoice",
  status: "valid",
  label: "Consistente en validación preliminar",
  invoice: {
    invoiceNumber: "FAC-001",
    issueDate: "2026-11-01",
    vendorName: "Proveedor de prueba",
    total: { amount: 116, currencyCode: "MXN" },
  },
  checks: [],
  disclaimer: "Validación preliminar.",
  pageCount: 1,
};

before(async () => {
  server = createApp({
    openai,
    agentRef,
    invoiceStorage,
    invoiceAnalyzer: async (document) => {
      analyzedInvoices.push(document);
      return invoiceAnalysis;
    },
    authStore: testAuthStore,
    tokenSecret: testTokenSecret,
    supplierPaymentsLoader: async () => {
      supplierPaymentsRequests += 1;
      return {
        referenceDate: "2026-11-01",
        fictional: true,
        counts: { paid: 1, pending: 1, overdue: 1 },
        records: [],
      };
    },
    deliveryReadinessLoader: async () => {
      deliveryReadinessRequests += 1;
      return {
        referenceDate: "2026-11-02",
        inventoryReferenceDate: "2026-10-31",
        deliveriesReferenceDate: "2026-10-31",
        fictional: true,
        counts: { delivered: 1, ready: 1, shortage: 1, unknown: 0 },
        records: [],
      };
    },
    salesPerformanceLoader: async () => {
      salesPerformanceRequests += 1;
      return {
        referenceDate: "2026-11-02",
        deliveriesReferenceDate: "2026-10-31",
        fictional: true,
        completedDeliveryCount: 1,
        unitsSold: 5,
        collectedRevenue: null,
        salesByMonth: [],
        topProducts: [],
        topCustomers: [],
        salesDateBasis: "Fecha de entrega registrada.",
      };
    },
  }).listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  for (const section of ["invoices", "suppliers", "deliveries", "sales"]) {
    accessCookies[section] = await loginForSection(baseUrl, section);
  }
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("health responde status ok y publica la interfaz", async () => {
  const healthResponse = await fetch(`${baseUrl}/health`);
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), { status: "ok" });

  const pageResponse = await fetch(baseUrl);
  assert.equal(pageResponse.status, 200);
  const page = await pageResponse.text();
  assert.match(page, /Asistente virtual/);
  assert.match(page, /Ejemplos, extracción y revisión/);
  assert.match(page, /no se envía al chatbot/);
  assert.match(page, /OCR local/);
  assert.doesNotMatch(page, /Azure AI Document\s+Intelligence/);
  assert.match(page, /id="login-screen"/);
  assert.match(page, /Entrar como Invitado/);
  assert.match(page, /<details class="invoice-section"/);
  assert.ok(page.indexOf('id="chat-form"') < page.indexOf('<details class="invoice-section"'));
  assert.match(page, /<details class="supplier-section"/);
  assert.match(page, /<details class="delivery-section"/);
  assert.match(page, /<details class="sales-section"/);
  assert.match(page, /Preguntar por voz/);
  assert.ok(page.indexOf('<details class="invoice-section"') < page.indexOf('<details class="supplier-section"'));
  assert.ok(page.indexOf('id="chat-form"') < page.indexOf('<details class="supplier-section"'));
  assert.ok(page.indexOf('<details class="supplier-section"') < page.indexOf('<details class="delivery-section"'));
  assert.ok(page.indexOf('id="chat-form"') < page.indexOf('<details class="delivery-section"'));

  const logoResponse = await fetch(`${baseUrl}/logo.svg`);
  assert.equal(logoResponse.status, 200);
  assert.match(logoResponse.headers.get("content-type"), /image\/svg\+xml/);
  assert.match(await logoResponse.text(), /<svg/);

  const invoiceConfig = await fetch(`${baseUrl}/api/invoices/config`);
  assert.equal(invoiceConfig.status, 401);
  const authorizedInvoiceConfig = await fetch(`${baseUrl}/api/invoices/config`, {
    headers: { Cookie: accessCookies.invoices },
  });
  assert.deepEqual(await authorizedInvoiceConfig.json(), {
    enabled: true,
    galleryEnabled: true,
    analysisEnabled: true,
  });

  const supplierConfig = await fetch(`${baseUrl}/api/suppliers/config`, {
    headers: { Cookie: accessCookies.suppliers },
  });
  assert.deepEqual(await supplierConfig.json(), { enabled: true });

  const deliveryConfig = await fetch(`${baseUrl}/api/deliveries/config`, {
    headers: { Cookie: accessCookies.deliveries },
  });
  assert.deepEqual(await deliveryConfig.json(), { enabled: true });

  const salesConfig = await fetch(`${baseUrl}/api/sales/config`, {
    headers: { Cookie: accessCookies.sales },
  });
  assert.deepEqual(await salesConfig.json(), { enabled: true });
});

test("inicia y cierra sesiones JWT con cookie HttpOnly", async () => {
  const sessionResponse = await fetch(`${baseUrl}/api/auth/session`);
  assert.deepEqual(await sessionResponse.json(), { authenticated: false });

  const wrongAccount = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: accessCookies.invoices,
    },
    body: JSON.stringify({ username: "mariana", password: "not-the-password" }),
  });
  assert.equal(wrongAccount.status, 401);
  assert.equal(wrongAccount.headers.get("set-cookie"), null);
  assert.equal(
    (await wrongAccount.json()).detail,
    "Usuario o contraseña incorrectos",
  );

  const cookie = await loginForSection(baseUrl, "invoices");
  assert.match(cookie, /^rio_claro_access=/);
  const authenticated = await fetch(
    `${baseUrl}/api/auth/session`,
    { headers: { Cookie: cookie } },
  );
  const session = await authenticated.json();
  assert.equal(session.authenticated, true);
  assert.equal(session.user.name, "Laura");
  assert.equal(session.user.role, "Finanzas");

  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie"), /Expires=Thu, 01 Jan 1970/);

  const afterLogout = await fetch(`${baseUrl}/api/auth/session`, {
    headers: { Cookie: cookie },
  });
  assert.equal((await afterLogout.json()).authenticated, false);
});

test("invitado y rutas directas respetan los permisos", async () => {
  const anonymousPage = await fetch(`${baseUrl}/facturas`, {
    redirect: "manual",
  });
  assert.equal(anonymousPage.status, 302);
  assert.equal(anonymousPage.headers.get("location"), "/login");

  const financePage = await fetch(`${baseUrl}/entregas`, {
    headers: { Cookie: accessCookies.invoices },
    redirect: "manual",
  });
  assert.equal(financePage.status, 302);
  assert.equal(financePage.headers.get("location"), "/acceso-denegado");

  const guestLogin = await fetch(`${baseUrl}/api/auth/guest`, {
    method: "POST",
  });
  assert.equal(guestLogin.status, 200);
  assert.match((await guestLogin.json()).message, /limitado al Asistente Virtual/);
  const guestCookie = guestLogin.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .filter((value) => value.startsWith("rio_claro_access="))
    .join("; ");

  const guestChat = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: guestCookie,
    },
    body: JSON.stringify({ message: "Hola" }),
  });
  assert.equal(guestChat.status, 200);

  const guestInvoices = await fetch(`${baseUrl}/api/invoices`, {
    headers: { Cookie: guestCookie },
  });
  assert.equal(guestInvoices.status, 403);
  assert.deepEqual(await guestInvoices.json(), {
    detail: "No tienes permiso para acceder a este apartado.",
  });

  const guestPage = await fetch(`${baseUrl}/facturas`, {
    headers: { Cookie: guestCookie },
    redirect: "manual",
  });
  assert.equal(guestPage.status, 302);
  assert.equal(guestPage.headers.get("location"), "/acceso-denegado");
});

test("fuerza cambio de contraseña inicial antes de permitir el acceso", async () => {
  const cookie = await loginForUsername(
    baseUrl,
    "temp",
    "temporary-test-password",
  );
  const protectedResponse = await fetch(`${baseUrl}/api/invoices`, {
    headers: { Cookie: cookie },
  });
  assert.equal(protectedResponse.status, 403);
  assert.deepEqual(await protectedResponse.json(), {
    code: "PASSWORD_CHANGE_REQUIRED",
    detail: "Debes cambiar tu contraseña antes de continuar.",
  });

  const changeResponse = await fetch(`${baseUrl}/api/auth/change-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      currentPassword: "temporary-test-password",
      newPassword: "new-temporary-test-password",
    }),
  });
  assert.equal(changeResponse.status, 200);
  assert.deepEqual(await changeResponse.json(), { changed: true });

  const allowedResponse = await fetch(`${baseUrl}/api/invoices`, {
    headers: { Cookie: cookie },
  });
  assert.equal(allowedResponse.status, 200);
});

test("administración de usuarios exige rol autorizado y emite clave temporal", async () => {
  const denied = await fetch(`${baseUrl}/api/admin/users`, {
    headers: { Cookie: accessCookies.invoices },
  });
  assert.equal(denied.status, 403);

  const adminCookie = await loginForUsername(
    baseUrl,
    "carlos",
    "admin-test-password",
  );
  const created = await fetch(`${baseUrl}/api/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminCookie,
    },
    body: JSON.stringify({
      name: "Prueba de usuario",
      username: "test-user",
      email: "test@example.com",
      role: "Comercial",
    }),
  });
  assert.equal(created.status, 201);
  const createdUser = await created.json();
  assert.equal(createdUser.mustChangePassword, true);
  assert.ok(createdUser.temporaryPassword.length >= 24);

  const deniedDeletion = await fetch(
    `${baseUrl}/api/admin/users/${encodeURIComponent(createdUser.id)}`,
    {
      method: "DELETE",
      headers: { Cookie: adminCookie },
    },
  );
  assert.equal(deniedDeletion.status, 403);
  assert.deepEqual(await deniedDeletion.json(), {
    detail: "No tienes permiso para eliminar usuarios.",
  });

  const usersAfterDeniedDeletion = await fetch(`${baseUrl}/api/admin/users`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(usersAfterDeniedDeletion.status, 200);
  assert.ok(
    (await usersAfterDeniedDeletion.json()).users.some(
      ({ id }) => id === createdUser.id,
    ),
  );

  const esdrasResponse = await fetch(`${baseUrl}/api/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminCookie,
    },
    body: JSON.stringify({
      name: "Esdras",
      username: "esdras",
      role: "Administrador",
    }),
  });
  assert.equal(esdrasResponse.status, 201);
  const esdras = await esdrasResponse.json();

  const deniedEsdrasEdit = await fetch(
    `${baseUrl}/api/admin/users/${encodeURIComponent(esdras.id)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({ name: "Nombre modificado" }),
    },
  );
  assert.equal(deniedEsdrasEdit.status, 403);
  assert.deepEqual(await deniedEsdrasEdit.json(), {
    detail: "No tienes permiso para modificar al usuario Esdras.",
  });

  const deniedEsdrasDeactivation = await fetch(
    `${baseUrl}/api/admin/users/${encodeURIComponent(esdras.id)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({ status: "inactivo" }),
    },
  );
  assert.equal(deniedEsdrasDeactivation.status, 403);

  const deniedEsdrasPasswordReset = await fetch(
    `${baseUrl}/api/admin/users/${encodeURIComponent(esdras.id)}/reset-password`,
    {
      method: "POST",
      headers: { Cookie: adminCookie },
    },
  );
  assert.equal(deniedEsdrasPasswordReset.status, 403);
  assert.deepEqual(await deniedEsdrasPasswordReset.json(), {
    detail: "No tienes permiso para restablecer la contraseña de Esdras.",
  });

  const unchangedEsdras = await testAuthStore.findUserById(esdras.id);
  assert.equal(unchangedEsdras.name, "Esdras");
  assert.equal(unchangedEsdras.status, "activo");
  const esdrasLogin = await loginForUsername(
    baseUrl,
    "esdras",
    esdras.temporaryPassword,
  );
  assert.ok(esdrasLogin);

  const deniedUsernameChange = await fetch(
    `${baseUrl}/api/admin/users/${encodeURIComponent(
      (await testAuthStore.findUserByUsername("carlos")).id,
    )}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({ username: "carlos-renamed" }),
    },
  );
  assert.equal(deniedUsernameChange.status, 403);

  const createdLogin = await loginForUsername(
    baseUrl,
    "test-user",
    createdUser.temporaryPassword,
  );
  const forcedChange = await fetch(`${baseUrl}/api/auth/session`, {
    headers: { Cookie: createdLogin },
  });
  assert.equal((await forcedChange.json()).user.mustChangePassword, true);

  const deniedPromotion = await fetch(`${baseUrl}/api/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: accessCookies.invoices,
    },
    body: JSON.stringify({
      name: "Usuario escalado",
      username: "escalado",
      role: "Administrador",
    }),
  });
  assert.equal(deniedPromotion.status, 403);
});

test("muestra ejemplos y facturas guardadas solo con sesión de Laura", async () => {
  const denied = await fetch(`${baseUrl}/api/invoices/samples`);
  assert.equal(denied.status, 401);

  const headers = { Cookie: accessCookies.invoices };
  const samplesResponse = await fetch(`${baseUrl}/api/invoices/samples`, {
    headers,
  });
  assert.equal(samplesResponse.status, 200);
  const samples = await samplesResponse.json();
  assert.deepEqual(
    samples.records.map(({ fileName }) => fileName).sort(),
    [
      "factura_distinta.pdf",
      "factura_final2.pdf",
      "factura_foto_borrosa.jpg",
      "factura_limpia.pdf",
      "factura_monto_borroso.jpg",
    ],
  );
  assert.equal(
    samples.records.find(({ fileName }) => fileName === "factura_limpia.pdf").label,
    "Factura limpia",
  );
  assert.equal(
    samples.records.find(({ fileName }) => fileName === "factura_final2.pdf").label,
    "Factura final",
  );

  const privateSample = await fetch(
    `${baseUrl}/api/invoices/samples/${encodeURIComponent("factura_limpia.pdf")}`,
    { headers },
  );
  assert.equal(privateSample.status, 200);
  assert.match(privateSample.headers.get("content-type"), /application\/pdf/);
  assert.match(privateSample.headers.get("cache-control"), /no-store/);
  assert.equal(
    (await privateSample.arrayBuffer()).byteLength > 1000,
    true,
  );

  const publicSample = await fetch(
    `${baseUrl}/Documentos/Facturas/factura_limpia.pdf`,
  );
  assert.equal(publicSample.status, 404);

  const uploads = await fetch(`${baseUrl}/api/invoices`, { headers });
  assert.deepEqual(await uploads.json(), {
    records: [
      {
        id: "00000000-0000-4000-8000-000000000001.pdf",
        fileName: "factura guardada.pdf",
        contentType: "application/pdf",
        createdAt: "2026-11-02T12:00:00.000Z",
      },
    ],
  });

  const privateUpload = await fetch(
    `${baseUrl}/api/invoices/00000000-0000-4000-8000-000000000001.pdf/file`,
    { headers },
  );
  assert.equal(privateUpload.status, 200);
  assert.match(await privateUpload.text(), /factura de prueba/);
});

test("analiza ejemplos y facturas guardadas con sesión autorizada", async () => {
  const denied = await fetch(
    `${baseUrl}/api/invoices/samples/factura_limpia.pdf/analyze`,
    { method: "POST" },
  );
  assert.equal(denied.status, 401);

  const headers = { Cookie: accessCookies.invoices };
  const sampleResponse = await fetch(
    `${baseUrl}/api/invoices/samples/factura_limpia.pdf/analyze`,
    { method: "POST", headers },
  );
  assert.equal(sampleResponse.status, 200);
  assert.deepEqual(await sampleResponse.json(), invoiceAnalysis);
  assert.equal(analyzedInvoices.at(-1).contentType, "application/pdf");
  assert.match(analyzedInvoices.at(-1).buffer.toString("utf8", 0, 8), /%PDF/);

  const uploadResponse = await fetch(
    `${baseUrl}/api/invoices/00000000-0000-4000-8000-000000000001.pdf/analyze`,
    { method: "POST", headers },
  );
  assert.equal(uploadResponse.status, 200);
  assert.deepEqual(await uploadResponse.json(), invoiceAnalysis);
  assert.match(analyzedInvoices.at(-1).buffer.toString(), /factura de prueba/);
});

test("restringe entregas al rol de Logística", async () => {
  const denied = await fetch(`${baseUrl}/api/deliveries`);
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), { detail: "Inicia sesión para continuar." });

  const invalidKey = await fetch(`${baseUrl}/api/deliveries`, {
    headers: { Cookie: accessCookies.invoices },
  });
  assert.equal(invalidKey.status, 403);
  assert.deepEqual(await invalidKey.json(), {
    detail: "No tienes permiso para acceder a este apartado.",
  });
  assert.equal(deliveryReadinessRequests, 0);

  const authorized = await fetch(`${baseUrl}/api/deliveries`, {
    headers: { Cookie: accessCookies.deliveries },
  });
  assert.equal(authorized.status, 200);
  assert.deepEqual(await authorized.json(), {
    referenceDate: "2026-11-02",
    inventoryReferenceDate: "2026-10-31",
    deliveriesReferenceDate: "2026-10-31",
    fictional: true,
    counts: { delivered: 1, ready: 1, shortage: 1, unknown: 0 },
    records: [],
  });
  assert.equal(deliveryReadinessRequests, 1);
});

test("restringe proveedores al rol de Finanzas", async () => {
  const denied = await fetch(`${baseUrl}/api/suppliers`);
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), { detail: "Inicia sesión para continuar." });

  const invalidKey = await fetch(`${baseUrl}/api/suppliers`, {
    headers: { Cookie: accessCookies.deliveries },
  });
  assert.equal(invalidKey.status, 403);
  assert.equal(supplierPaymentsRequests, 0);

  const authorized = await fetch(`${baseUrl}/api/suppliers`, {
    headers: { Cookie: accessCookies.suppliers },
  });
  assert.equal(authorized.status, 200);
  assert.deepEqual(await authorized.json(), {
    referenceDate: "2026-11-01",
    fictional: true,
    counts: { paid: 1, pending: 1, overdue: 1 },
    records: [],
  });
  assert.equal(supplierPaymentsRequests, 1);
});

test("restringe ventas al rol Comercial", async () => {
  const denied = await fetch(`${baseUrl}/api/sales`);
  assert.equal(denied.status, 401);
  assert.equal(salesPerformanceRequests, 0);

  const authorized = await fetch(`${baseUrl}/api/sales`, {
    headers: { Cookie: accessCookies.sales },
  });
  assert.equal(authorized.status, 200);
  const report = await authorized.json();
  assert.equal(report.unitsSold, 5);
  assert.equal(report.collectedRevenue, null);
  assert.equal("grossProfit" in report, false);
  assert.equal("topProfitProducts" in report, false);
  assert.equal(salesPerformanceRequests, 1);
});

test("requiere iniciar sesión antes de recibir facturas", async () => {
  const formData = new FormData();
  formData.append(
    "invoice",
    new Blob(["%PDF-1.7"], { type: "application/pdf" }),
    "factura.pdf",
  );
  const response = await fetch(`${baseUrl}/api/invoices`, {
    method: "POST",
    body: formData,
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    detail: "Inicia sesión para continuar.",
  });
  assert.equal(savedInvoices.length, 0);
});

test("guarda facturas PDF, JPG y PNG con sesión y nombre seguro", async () => {
  const validInvoices = [
    {
      name: "factura.pdf",
      type: "application/pdf",
      content: Buffer.from("%PDF-1.7\ncontenido de prueba"),
      extension: ".pdf",
    },
    {
      name: "factura.jpg",
      type: "image/jpeg",
      content: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      extension: ".jpg",
    },
    {
      name: "factura.png",
      type: "image/png",
      content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      extension: ".png",
    },
  ];

  for (const [index, invoice] of validInvoices.entries()) {
    const formData = new FormData();
    formData.append(
      "invoice",
      new Blob([invoice.content], { type: invoice.type }),
      invoice.name,
    );
    const response = await fetch(`${baseUrl}/api/invoices`, {
      method: "POST",
      headers: { Cookie: accessCookies.invoices },
      body: formData,
    });
    const result = await response.json();

    assert.equal(response.status, 201);
    assert.equal(result.invoice_id, `invoice-test-${index + 1}`);
    assert.equal(result.file_name, invoice.name);
    assert.deepEqual(result.analysis, invoiceAnalysis);
    assert.equal(savedInvoices[index].extension, invoice.extension);
    assert.equal(savedInvoices[index].file.originalname, invoice.name);
    assert.deepEqual(savedInvoices[index].file.buffer, invoice.content);
  }
});

test("rechaza tipos de archivo y firmas que no coinciden", async () => {
  const formData = new FormData();
  formData.append(
    "invoice",
    new Blob(["contenido no PDF"], { type: "application/pdf" }),
    "factura.pdf",
  );
  const response = await fetch(`${baseUrl}/api/invoices`, {
    method: "POST",
    headers: { Cookie: accessCookies.invoices },
    body: formData,
  });

  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    detail: "Sube una factura PDF, JPG o PNG válida.",
  });
  assert.equal(savedInvoices.length, 3);
});

test("rechaza archivos mayores a 10 MB", async () => {
  const formData = new FormData();
  formData.append(
    "invoice",
    new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], {
      type: "application/pdf",
    }),
    "factura.pdf",
  );
  const response = await fetch(`${baseUrl}/api/invoices`, {
    method: "POST",
    headers: { Cookie: accessCookies.invoices },
    body: formData,
  });

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {
    detail: "La factura no puede superar los 10 MB.",
  });
  assert.equal(savedInvoices.length, 3);
});

test("deshabilita la carga cuando no hay almacenamiento ni acceso configurados", async () => {
  const unconfiguredServer = createApp({
    openai,
    agentRef,
    authStore: testAuthStore,
    tokenSecret: testTokenSecret,
  }).listen(
    0,
    "127.0.0.1",
  );
  await new Promise((resolve, reject) => {
    unconfiguredServer.once("listening", resolve);
    unconfiguredServer.once("error", reject);
  });

  try {
    const unconfiguredUrl = `http://127.0.0.1:${unconfiguredServer.address().port}`;
    const cookie = await loginForSection(unconfiguredUrl, "invoices");
    const configResponse = await fetch(`${unconfiguredUrl}/api/invoices/config`, {
      headers: { Cookie: cookie },
    });
    assert.deepEqual(await configResponse.json(), {
      enabled: false,
      galleryEnabled: true,
      analysisEnabled: false,
    });

    const response = await fetch(`${unconfiguredUrl}/api/invoices`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      detail: "La carga de facturas no está configurada.",
    });
  } finally {
    await new Promise((resolve, reject) => {
      unconfiguredServer.close((error) =>
        error ? reject(error) : resolve(),
      );
    });
  }
});

test("rechaza un mensaje vacío con 422 y el detalle acordado", async () => {
  calls.length = 0;
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: accessCookies.invoices,
    },
    body: JSON.stringify({ message: "   " }),
  });

  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    detail:
      "El asistente no esta disponible en este momento, contacte a su superior.",
  });
  assert.equal(calls.length, 0);
});

test("rechaza mensajes mayores a 2000 caracteres", async () => {
  calls.length = 0;
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: accessCookies.invoices,
    },
    body: JSON.stringify({ message: "x".repeat(2001) }),
  });

  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    detail: "El mensaje debe tener entre 1 y 2000 caracteres.",
  });
  assert.equal(calls.length, 0);
});

test("una pregunta y su seguimiento conservan la conversación", async () => {
  calls.length = 0;
  const firstResponse = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: accessCookies.invoices,
    },
    body: JSON.stringify({ message: "¿Qué es el proyecto Río Claro?" }),
  });
  const first = await firstResponse.json();

  assert.equal(firstResponse.status, 200);
  assert.equal(first.conversation_id, "conversation-test-1");

  const followupResponse = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: accessCookies.invoices,
    },
    body: JSON.stringify({
      message: "Dame un ejemplo.",
      conversation_id: first.conversation_id,
    }),
  });
  const followup = await followupResponse.json();

  assert.equal(followupResponse.status, 200);
  assert.equal(followup.conversation_id, first.conversation_id);
  assert.deepEqual(
    calls.map(({ request }) => request.conversation),
    ["conversation-test-1", "conversation-test-1"],
  );
  assert.deepEqual(
    calls.map(({ options }) => options),
    [agentRef, agentRef],
  );
});

test("Foundry falla sin exponer detalles internos", async () => {
  for (const message of ["trigger-foundry-error", "empty-foundry-response"]) {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: accessCookies.invoices,
      },
      body: JSON.stringify({ message }),
    });
    const result = await response.json();

    assert.equal(response.status, 502);
    assert.deepEqual(result, {
      detail:
        "El asistente no esta disponible en este momento, contacte a su superior.",
    });
    assert.equal(JSON.stringify(result).includes("simulated Foundry failure"), false);
  }
});
