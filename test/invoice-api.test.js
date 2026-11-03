import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createApp } from "../server.js";
import { createInvoiceAnalyzer } from "../invoice-analysis.js";
import { createLocalInvoiceStorage } from "../invoice-storage.js";
import {
  loginForSection,
  testAuthStore,
  testTokenSecret,
} from "../test-support/access-fixtures.js";

const activeServers = new Set();
const sessionCookies = new Map();
const sampleDirectory = join(import.meta.dirname, "..", "Documentos", "Facturas");

async function startInvoiceServer({ invoiceStorage, invoiceAnalyzer }) {
  const server = createApp({
    openai: {},
    agentRef: {},
    invoiceStorage,
    invoiceAnalyzer,
    authStore: testAuthStore,
    tokenSecret: testTokenSecret,
  }).listen(0, "127.0.0.1");
  activeServers.add(server);
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  sessionCookies.set(baseUrl, await loginForSection(baseUrl, "invoices"));
  return baseUrl;
}

async function uploadInvoice(baseUrl, buffer, fileName, contentType) {
  const formData = new FormData();
  formData.append("invoice", new Blob([buffer], { type: contentType }), fileName);
  return fetch(`${baseUrl}/api/invoices`, {
    method: "POST",
    headers: { Cookie: sessionCookies.get(baseUrl) },
    body: formData,
  });
}

after(async () => {
  await Promise.all(
    [...activeServers].map(
      (server) =>
        new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

test("carga, guarda, lista, previsualiza y analiza una factura usando almacenamiento local", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "rio-claro-invoice-api-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const storage = createLocalInvoiceStorage(directory);
  const baseUrl = await startInvoiceServer({
    invoiceStorage: storage,
    invoiceAnalyzer: createInvoiceAnalyzer(),
  });
  const original = await readFile(join(sampleDirectory, "factura_limpia.pdf"));

  const uploadResponse = await uploadInvoice(
    baseUrl,
    original,
    "factura de prueba.pdf",
    "application/pdf",
  );
  assert.equal(uploadResponse.status, 201);
  const upload = await uploadResponse.json();
  assert.equal(upload.file_name, "factura de prueba.pdf");
  assert.equal(upload.analysis.status, "valid");
  assert.equal(upload.analysis.invoice.invoiceNumber, "FAC-2026-001");
  assert.equal(upload.analysis.invoice.total.amount, 30392);
  assert.equal(upload.analysis_error, null);

  const headers = { Cookie: sessionCookies.get(baseUrl) };
  const listResponse = await fetch(`${baseUrl}/api/invoices`, { headers });
  assert.equal(listResponse.status, 200);
  const records = (await listResponse.json()).records;
  assert.equal(records.length, 1);
  assert.equal(records[0].id, upload.invoice_id);
  assert.equal(records[0].fileName, "factura de prueba.pdf");

  const fileResponse = await fetch(
    `${baseUrl}/api/invoices/${encodeURIComponent(upload.invoice_id)}/file`,
    { headers },
  );
  assert.equal(fileResponse.status, 200);
  assert.deepEqual(Buffer.from(await fileResponse.arrayBuffer()), original);

  const analysisResponse = await fetch(
    `${baseUrl}/api/invoices/${encodeURIComponent(upload.invoice_id)}/analyze`,
    { method: "POST", headers },
  );
  assert.equal(analysisResponse.status, 200);
  const analysis = await analysisResponse.json();
  assert.equal(analysis.status, "valid");
  assert.equal(analysis.invoice.invoiceNumber, "FAC-2026-001");
});

test("conserva la factura y permite reintentar si el OCR falla", async () => {
  const savedInvoices = [];
  const storage = {
    async saveInvoice({ file }) {
      savedInvoices.push(file);
      return "saved-invoice.pdf";
    },
    async listInvoices() {
      return [];
    },
    async readInvoice() {
      return null;
    },
  };
  const baseUrl = await startInvoiceServer({
    invoiceStorage: storage,
    invoiceAnalyzer: async () => {
      throw new Error("simulated local OCR failure");
    },
  });

  const response = await uploadInvoice(
    baseUrl,
    Buffer.from("%PDF-1.7\ninvoice"),
    "factura.pdf",
    "application/pdf",
  );
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.invoice_id, "saved-invoice.pdf");
  assert.equal(result.analysis, null);
  assert.match(result.analysis_error, /se guardó correctamente/i);
  assert.match(result.detail, /se guardó de forma privada/i);
  assert.equal(savedInvoices.length, 1);
});

test("no guarda una factura ya registrada aunque cambie el nombre o los bytes del PDF", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "rio-claro-invoice-dedup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const storage = createLocalInvoiceStorage(directory);
  const baseUrl = await startInvoiceServer({
    invoiceStorage: storage,
    invoiceAnalyzer: createInvoiceAnalyzer(),
  });
  const original = await readFile(join(sampleDirectory, "factura_limpia.pdf"));
  const firstResponse = await uploadInvoice(
    baseUrl,
    original,
    "factura original.pdf",
    "application/pdf",
  );
  assert.equal(firstResponse.status, 201);

  const exactDuplicateResponse = await uploadInvoice(
    baseUrl,
    original,
    "otra copia con nombre diferente.pdf",
    "application/pdf",
  );
  assert.equal(exactDuplicateResponse.status, 409);
  const exactDuplicate = await exactDuplicateResponse.json();
  assert.equal(exactDuplicate.duplicate.match, "contenido");
  assert.equal((await storage.listInvoices()).length, 1);

  const alteredBytes = Buffer.concat([
    original,
    Buffer.from("\n% comentario que no cambia los datos fiscales\n"),
  ]);
  const duplicateResponse = await uploadInvoice(
    baseUrl,
    alteredBytes,
    "copia con otro nombre.pdf",
    "application/pdf",
  );
  assert.equal(duplicateResponse.status, 409);
  const duplicate = await duplicateResponse.json();
  assert.match(duplicate.detail, /ya está guardada/i);
  assert.match(duplicate.detail, /factura original\.pdf/);
  assert.equal(duplicate.duplicate.match, "datos de factura");
  assert.equal((await storage.listInvoices()).length, 1);
});

test("serializa cargas simultáneas para no aceptar dos copias de la misma factura", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "rio-claro-invoice-race-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const storage = createLocalInvoiceStorage(directory);
  const baseUrl = await startInvoiceServer({
    invoiceStorage: storage,
    invoiceAnalyzer: createInvoiceAnalyzer(),
  });
  const original = await readFile(join(sampleDirectory, "factura_limpia.pdf"));
  const responses = await Promise.all([
    uploadInvoice(baseUrl, original, "factura A.pdf", "application/pdf"),
    uploadInvoice(baseUrl, original, "factura B.pdf", "application/pdf"),
  ]);

  assert.deepEqual(
    responses.map(({ status }) => status).sort(),
    [201, 409],
  );
  assert.equal((await storage.listInvoices()).length, 1);
});
