import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSupplierPayments, parseSupplierPayments } from "../suppliers.js";

test("calcula pagados, pendientes y vencidos desde el registro y la fecha local", async () => {
  const report = await loadSupplierPayments({ today: "2026-11-01" });

  assert.equal(report.referenceDate, "2026-11-01");
  assert.equal(report.fictional, true);
  assert.deepEqual(report.counts, { paid: 9, pending: 12, overdue: 9 });

  const pending = report.records.find(
    ({ supplier, dueDate }) =>
      supplier.startsWith("Papelera Mexicana") && dueDate === "2026-11-14",
  );
  assert.equal(pending.status, "pending");
  assert.equal(pending.daysUntilDue, 13);

  const paid = report.records.find(
    ({ supplier, dueDate }) =>
      supplier.startsWith("Química Industrial") && dueDate === "2026-10-02",
  );
  assert.equal(paid.status, "paid");
  assert.equal(paid.paidDate, "2026-09-29");

  const overdue = report.records.find(
    ({ supplier, dueDate }) =>
      supplier.startsWith("Distribuidora de Higiene Integral") &&
      dueDate === "2026-10-01",
  );
  assert.equal(overdue.status, "overdue");
  assert.equal(overdue.daysUntilDue, null);
});

test("un pago que vence hoy sigue pendiente y muestra cero días", () => {
  const markdown = [
    "Registro ficticio",
    "Proveedor (razón social)\tTotal (MXN)\tDescripción\tEstado\tFecha de emisión\tFecha límite\tFecha de pago",
    "Proveedor de prueba\t$100.00\tInsumos de ejemplo.\tPendiente\t2026-10-01\t2026-11-01\t",
  ].join("\n");
  const report = parseSupplierPayments(markdown, { today: "2026-11-01" });

  assert.deepEqual(report.counts, { paid: 0, pending: 1, overdue: 0 });
  assert.equal(report.records[0].daysUntilDue, 0);
});

test("rechaza fechas de referencia inválidas", () => {
  assert.throws(
    () => parseSupplierPayments("Inventario ficticio", { today: "2026-02-30" }),
    /fecha de referencia.*no es válida/i,
  );
});
