import { loadDeliveryReadiness } from "./deliveries.js";

function normalizeText(value) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es-MX")
    .replace(/\s+/g, " ")
    .trim();
}

function aggregateSales(records, keySelector, labelSelector) {
  const grouped = new Map();
  for (const record of records) {
    const key = keySelector(record);
    const current = grouped.get(key) ?? {
      label: labelSelector(record),
      orderCount: 0,
      unitsSold: 0,
    };
    current.orderCount += 1;
    current.unitsSold += record.quantity;
    grouped.set(key, current);
  }
  return [...grouped.values()].sort(
    (first, second) =>
      second.unitsSold - first.unitsSold ||
      second.orderCount - first.orderCount ||
      first.label.localeCompare(second.label, "es-MX"),
  );
}

export function buildSalesPerformance(deliveryReport) {
  const completedDeliveries = deliveryReport.records.filter(
    ({ fulfillment }) => fulfillment === "delivered",
  );
  const salesByMonth = aggregateSales(
    completedDeliveries,
    ({ deliveryDate }) => deliveryDate.slice(0, 7),
    ({ deliveryDate }) => deliveryDate.slice(0, 7),
  )
    .map(({ label, orderCount, unitsSold }) => ({
      month: label,
      orderCount,
      unitsSold,
    }))
    .sort((first, second) => first.month.localeCompare(second.month));

  const topProducts = aggregateSales(
    completedDeliveries,
    ({ sku, product }) => sku ?? normalizeText(product),
    ({ product }) => product,
  ).map(({ label, orderCount, unitsSold }) => ({
    product: label,
    orderCount,
    unitsSold,
  }));
  const topCustomers = aggregateSales(
    completedDeliveries,
    ({ customer }) => normalizeText(customer),
    ({ customer }) => customer,
  ).map(({ label, orderCount, unitsSold }) => ({
    customer: label,
    orderCount,
    unitsSold,
  }));

  return {
    referenceDate: deliveryReport.referenceDate,
    deliveriesReferenceDate: deliveryReport.deliveriesReferenceDate,
    fictional: deliveryReport.fictional,
    completedDeliveryCount: completedDeliveries.length,
    unitsSold: completedDeliveries.reduce(
      (total, { quantity }) => total + quantity,
      0,
    ),
    collectedRevenue: null,
    salesByMonth,
    topProducts,
    topCustomers,
    salesDateBasis:
      "Agrupación por fecha de entrega registrada; el archivo fuente no proporciona fecha de cobro.",
  };
}

export async function loadSalesPerformance(options) {
  return buildSalesPerformance(await loadDeliveryReadiness(options));
}
