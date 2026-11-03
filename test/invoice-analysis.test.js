import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { loadImage, PDFDocument } from "@napi-rs/canvas";
import {
  createInvoiceAnalyzer,
  validateInvoiceAnalysis,
} from "../invoice-analysis.js";

const sampleDirectory = join(import.meta.dirname, "..", "Documentos", "Facturas");

function createExtractedInvoice({
  subtotal = 100,
  tax = 16,
  total = 116,
  confidence = 0.99,
} = {}) {
  return {
    invoice: {
      invoiceNumber: "FAC-001",
      issueDate: "2026-11-01",
      vendorName: "Proveedor de prueba",
      vendorTaxId: "AAA010101AAA",
      customerName: "Cliente de prueba",
      subtotal: { amount: subtotal, currencyCode: "MXN" },
      tax: { amount: tax, currencyCode: "MXN" },
      total: { amount: total, currencyCode: "MXN" },
      items: [
        {
          description: "Producto de prueba",
          quantity: 2,
          unitPrice: { amount: 50, currencyCode: "MXN" },
          amount: { amount: 100, currencyCode: "MXN" },
        },
      ],
    },
    confidence: {
      invoiceNumber: confidence,
      issueDate: confidence,
      vendorName: confidence,
      total: confidence,
    },
    pageCount: 1,
  };
}

test("marca como consistente una factura completa con sumas conciliadas", () => {
  const result = validateInvoiceAnalysis(createExtractedInvoice());

  assert.equal(result.status, "valid");
  assert.equal(result.model, "Tesseract.js + PDF.js (local)");
  assert.equal(result.invoice.invoiceNumber, "FAC-001");
  assert.equal(result.invoice.vendorTaxId, "AAA010101AAA");
  assert.equal(result.invoice.total.amount, 116);
  assert.equal(result.invoice.items[0].description, "Producto de prueba");
  assert.equal(result.invoice.items[0].quantity, 2);
  assert.equal(result.pageCount, 1);
  assert.equal(
    result.checks.find(({ label }) => label === "Consistencia de importes").status,
    "passed",
  );
  assert.match(result.disclaimer, /no valida CFDI ante el SAT/i);
});

test("marca importes incongruentes como inválidos", () => {
  const result = validateInvoiceAnalysis(
    createExtractedInvoice({ total: 115 }),
  );

  assert.equal(result.status, "invalid");
  assert.equal(
    result.checks.find(({ label }) => label === "Consistencia de importes").status,
    "failed",
  );
});

test("manda a revisión manual facturas borrosas o con campos incompletos", () => {
  const blurry = validateInvoiceAnalysis(
    createExtractedInvoice({ confidence: 0.4 }),
  );
  assert.equal(blurry.status, "review");

  const incomplete = validateInvoiceAnalysis({
    invoice: { invoiceNumber: "FAC-002" },
    confidence: { invoiceNumber: 0.99 },
    pageCount: 1,
  });
  assert.equal(incomplete.status, "review");
  assert.match(incomplete.checks[0].message, /Fecha, Proveedor, Total/);
});

test("extrae localmente texto y partidas de una factura PDF digital", async () => {
  const analyzer = createInvoiceAnalyzer();
  const buffer = await readFile(join(sampleDirectory, "factura_limpia.pdf"));
  const result = await analyzer({ buffer, contentType: "application/pdf" });

  assert.equal(result.status, "valid");
  assert.equal(result.invoice.invoiceNumber, "FAC-2026-001");
  assert.equal(result.invoice.issueDate, "2026-10-12");
  assert.equal(result.invoice.vendorName, "Quimicos del Bajio, S.A. de C.V.");
  assert.equal(result.invoice.vendorTaxId, "QBA850312H78");
  assert.equal(result.invoice.customerName, "Distribuidora Rio Claro, S.A. de C.V.");
  assert.equal(result.invoice.subtotal.amount, 26200);
  assert.equal(result.invoice.tax.amount, 4192);
  assert.equal(result.invoice.total.amount, 30392);
  assert.equal(result.invoice.items.length, 3);
  assert.match(result.disclaimer, /localmente/i);
});

test("usa únicamente OCR local y manda imágenes borrosas a revisión", async () => {
  const analyzer = createInvoiceAnalyzer();
  const buffer = await readFile(
    join(sampleDirectory, "factura_foto_borrosa.jpg"),
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("El análisis local no debe usar la red.");
  };

  try {
    const result = await analyzer({ buffer, contentType: "image/jpeg" });
    assert.equal(result.status, "review");
    assert.equal(result.pageCount, 1);
    assert.equal(result.model, "Tesseract.js + PDF.js (local)");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("aplica OCR local a páginas escaneadas dentro de un PDF", async () => {
  const image = await loadImage(
    await readFile(join(sampleDirectory, "factura_foto_borrosa.jpg")),
  );
  const document = new PDFDocument();
  const context = document.beginPage(image.width, image.height);
  context.drawImage(image, 0, 0);
  document.endPage();
  const buffer = document.close();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("El análisis local no debe usar la red.");
  };

  try {
    const result = await createInvoiceAnalyzer()({
      buffer,
      contentType: "application/pdf",
    });
    assert.equal(result.status, "review");
    assert.equal(result.pageCount, 1);
    assert.match(result.checks[1].message, /Revisa la lectura/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
