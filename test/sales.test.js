import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSalesPerformance, loadSalesPerformance } from "../sales.js";

test("reporta ventas como entregas realizadas sin inventar cobros", async () => {
  const report = await loadSalesPerformance({ today: "2026-11-02" });

  assert.equal(report.referenceDate, "2026-11-02");
  assert.equal(report.deliveriesReferenceDate, "2026-10-31");
  assert.equal(report.fictional, true);
  assert.equal(report.completedDeliveryCount, 4);
  assert.equal(report.unitsSold, 630);
  assert.equal(report.salesByMonth.length, 1);
  assert.deepEqual(report.salesByMonth[0], {
    month: "2026-10",
    orderCount: 4,
    unitsSold: 630,
  });
  assert.deepEqual(report.topProducts[0], {
    product: "Cloro comercial",
    orderCount: 1,
    unitsSold: 500,
  });
  assert.deepEqual(report.topCustomers[0], {
    customer: "Hotel Costa Dorada, S.A. de C.V.",
    orderCount: 1,
    unitsSold: 500,
  });
  assert.equal(report.collectedRevenue, null);
  assert.equal("grossProfit" in report, false);
  assert.equal("topProfitProducts" in report, false);
  assert.doesNotMatch(JSON.stringify(report), /ganancia|profit/i);
});

test("excluye las entregas pendientes, retrasadas y en proceso", () => {
  const report = buildSalesPerformance({
    referenceDate: "2026-11-02",
    deliveriesReferenceDate: "2026-10-31",
    fictional: false,
    records: [
      {
        fulfillment: "delivered",
        deliveryDate: "2026-10-31",
        customer: "Cliente A",
        product: "Producto",
        sku: "SKU-1",
        quantity: 3,
      },
      {
        fulfillment: "ready",
        deliveryDate: "2026-11-02",
        customer: "Cliente B",
        product: "Producto",
        sku: "SKU-1",
        quantity: 50,
      },
      {
        fulfillment: "shortage",
        deliveryDate: "2026-10-20",
        customer: "Cliente C",
        product: "Otro",
        sku: null,
        quantity: 20,
      },
    ],
  });

  assert.equal(report.completedDeliveryCount, 1);
  assert.equal(report.unitsSold, 3);
  assert.equal(report.topCustomers.length, 1);
  assert.equal(report.topCustomers[0].customer, "Cliente A");
});
