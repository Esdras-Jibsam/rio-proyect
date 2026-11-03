import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createLocalInvoiceStorage } from "../invoice-storage.js";

test("guarda documentos fuera del sitio público y devuelve metadatos privados", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "rio-claro-invoices-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const storage = createLocalInvoiceStorage(directory);
  const buffer = Buffer.from("%PDF-1.7\nfactura privada");
  const invoiceId = await storage.saveInvoice({
    file: {
      originalname: "..\\factura confidencial.pdf",
      mimetype: "application/pdf",
      buffer,
    },
    extension: ".pdf",
  });

  assert.match(
    invoiceId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i,
  );
  assert.deepEqual(await storage.readInvoice(invoiceId), {
    buffer,
    contentType: "application/pdf",
  });
  assert.equal(await storage.readInvoice("../../secret.pdf"), null);
  assert.equal((await storage.listInvoices())[0].fileName, "factura confidencial.pdf");

  const entries = await readdir(directory);
  assert.equal(entries.length, 2);
  assert.equal(entries.includes("factura confidencial.pdf"), false);
  assert.deepEqual(
    await readFile(join(directory, invoiceId)),
    buffer,
  );
});

test("rechaza extensiones y tipos de contenido que no coinciden", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "rio-claro-invoices-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const storage = createLocalInvoiceStorage(directory);

  await assert.rejects(
    () =>
      storage.saveInvoice({
        file: {
          originalname: "invoice.pdf",
          mimetype: "image/png",
          buffer: Buffer.from("not a PDF"),
        },
        extension: ".pdf",
      }),
    /formato de factura no es válido/i,
  );
});
