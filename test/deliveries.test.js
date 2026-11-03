import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { assessDeliveries, loadDeliveryReadiness } from "../deliveries.js";

const documentsDirectory = path.join(import.meta.dirname, "..", "Documentos");

test("calcula disponibilidad por pedido usando el corte de inventario", async () => {
  const report = await loadDeliveryReadiness({ today: "2026-11-02" });

  assert.equal(report.referenceDate, "2026-11-02");
  assert.equal(report.inventoryReferenceDate, "2026-10-31");
  assert.equal(report.deliveriesReferenceDate, "2026-10-31");
  assert.equal(report.fictional, true);
  assert.deepEqual(report.counts, {
    delivered: 4,
    ready: 4,
    shortage: 1,
    unknown: 0,
  });

  const shortOrder = report.records.find(
    ({ customer }) => customer === "Colegio del Pacífico, A.C.",
  );
  assert.equal(shortOrder.fulfillment, "shortage");
  assert.equal(shortOrder.sku, "HIG-008");
  assert.equal(shortOrder.inventoryQuantity, 160);
  assert.equal(shortOrder.availableForOrder, 160);
  assert.equal(shortOrder.shortage, 40);

  const deliveredOrder = report.records.find(
    ({ customer }) => customer === "Hotel Real del Mar, S. de R.L. de C.V.",
  );
  assert.equal(deliveredOrder.fulfillment, "delivered");
  assert.equal(deliveredOrder.shortage, 0);
});

test("asigna existencias por fecha y no reutiliza stock en pedidos posteriores", () => {
  const inventory = [
    "Inventario ficticio · Fecha de referencia: 1 de noviembre de 2026",
    "SKU\tProducto\tDescripción\tCantidad\tÚltima actualización",
    "HIG-1\tJabón líquido\tProducto de prueba\t10\t2026-11-01",
  ].join("\n");
  const deliveries = [
    "Entregas ficticias · Fecha de referencia: 1 de noviembre de 2026",
    "Cliente (nombre o razón social)\tEstado de la entrega\tDescripcion\tCantidad\tFecha de solicitud\tDía de entrega\tDías de atraso",
    "Cliente tardío\tPendiente de enviar\tJabón líquido\t5\t2026-10-01\t2026-11-05\t0",
    "Cliente prioritario\tRetrasado\tJabón líquido\t8\t2026-10-02\t2026-11-02\t1",
    "Cliente desconocido\tPendiente de enviar\tProducto nuevo\t2\t2026-10-03\t2026-11-06\t0",
  ].join("\n");

  const report = assessDeliveries(deliveries, inventory, {
    today: "2026-11-02",
  });
  const prioritizedOrder = report.records.find(
    ({ customer }) => customer === "Cliente prioritario",
  );
  const laterOrder = report.records.find(
    ({ customer }) => customer === "Cliente tardío",
  );
  const unknownOrder = report.records.find(
    ({ customer }) => customer === "Cliente desconocido",
  );

  assert.equal(prioritizedOrder.fulfillment, "ready");
  assert.equal(prioritizedOrder.availableForOrder, 10);
  assert.equal(laterOrder.fulfillment, "shortage");
  assert.equal(laterOrder.availableForOrder, 2);
  assert.equal(laterOrder.shortage, 3);
  assert.equal(unknownOrder.fulfillment, "unknown");
  assert.equal(unknownOrder.shortage, null);
});

test("rechaza datos de inventario mal formados", async () => {
  const deliveriesMarkdown = await readFile(
    path.join(documentsDirectory, "Entregas.md"),
    "utf8",
  );
  assert.throws(
    () =>
      assessDeliveries(
        deliveriesMarkdown,
        "Fecha de referencia: 31 de octubre de 2026\nSKU\tProducto\tDescripción\tCantidad\tÚltima actualización\nSKU-1\tProducto\tDescripción\t-1\t2026-10-31",
        { today: "2026-11-02" },
      ),
    /datos inválidos/i,
  );
});

test("requiere fecha de corte en inventario y entregas", async () => {
  const deliveriesMarkdown = await readFile(
    path.join(documentsDirectory, "Entregas.md"),
    "utf8",
  );
  const inventoryMarkdown = await readFile(
    path.join(documentsDirectory, "InventarioGeneral.md"),
    "utf8",
  );
  assert.throws(
    () =>
      assessDeliveries(
        deliveriesMarkdown.replace(
          "Fecha de referencia: 31 de octubre de 2026",
          "Sin fecha de referencia",
        ),
        inventoryMarkdown,
        { today: "2026-11-02" },
      ),
    /entregas no incluye una fecha de referencia válida/i,
  );
});
