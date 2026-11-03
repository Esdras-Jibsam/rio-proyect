import { readFile } from "node:fs/promises";
import path from "node:path";

const documentsDirectory = path.join(import.meta.dirname, "Documentos");
const deliveriesFilePath = path.join(documentsDirectory, "Entregas.md");
const inventoryFilePath = path.join(documentsDirectory, "InventarioGeneral.md");
const mexicoCityTimeZone = "America/Mexico_City";
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const monthNumbers = new Map([
  ["enero", "01"],
  ["febrero", "02"],
  ["marzo", "03"],
  ["abril", "04"],
  ["mayo", "05"],
  ["junio", "06"],
  ["julio", "07"],
  ["agosto", "08"],
  ["septiembre", "09"],
  ["setiembre", "09"],
  ["octubre", "10"],
  ["noviembre", "11"],
  ["diciembre", "12"],
]);

function isValidDate(value) {
  if (!datePattern.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function getMexicoCityDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: mexicoCityTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function normalizeText(value) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es-MX")
    .replace(/\s+/g, " ")
    .trim();
}

function parseReferenceDate(markdown) {
  const match = markdown.match(
    /Fecha de referencia:\s*(\d{1,2}) de ([a-záéíóú]+) de (\d{4})/i,
  );
  if (!match) {
    return null;
  }

  const [, day, rawMonth, year] = match;
  const month = monthNumbers.get(normalizeText(rawMonth));
  if (!month) {
    return null;
  }

  const value = `${year}-${month}-${day.padStart(2, "0")}`;
  return isValidDate(value) ? value : null;
}

function parseInventory(markdown) {
  const rows = markdown
    .split(/\r?\n/)
    .filter((line) => line.includes("\t"))
    .map((line) => line.split("\t").map((value) => value.trim()))
    .filter(([sku]) => sku && sku !== "SKU");

  const inventory = new Map();
  for (const [index, columns] of rows.entries()) {
    if (columns.length < 5) {
      throw new Error(`El producto de inventario ${index + 1} está incompleto.`);
    }

    const [sku, product, description, rawQuantity, updatedAt] = columns;
    const quantity = Number(rawQuantity);
    if (
      !sku ||
      !product ||
      !Number.isSafeInteger(quantity) ||
      quantity < 0 ||
      !isValidDate(updatedAt)
    ) {
      throw new Error(`El producto de inventario ${index + 1} tiene datos inválidos.`);
    }

    const productKey = normalizeText(product);
    if (inventory.has(productKey)) {
      throw new Error(`El producto ${product} está duplicado en el inventario.`);
    }

    inventory.set(productKey, {
      sku,
      product,
      description,
      quantity,
      updatedAt,
    });
  }

  if (inventory.size === 0) {
    throw new Error("No se encontraron productos en el inventario.");
  }

  return inventory;
}

function parseDeliveryRows(markdown) {
  const rows = markdown
    .split(/\r?\n/)
    .filter((line) => line.includes("\t"))
    .map((line) => line.split("\t").map((value) => value.trim()))
    .filter(([customer]) => customer && customer !== "Cliente (nombre o razón social)");

  return rows.map((columns, index) => {
    if (columns.length < 7) {
      throw new Error(`La entrega ${index + 1} está incompleta.`);
    }

    const [
      customer,
      status,
      product,
      rawQuantity,
      requestedDate,
      deliveryDate,
      rawDelayDays,
    ] = columns;
    const quantity = Number(rawQuantity);
    const delayDays = Number(rawDelayDays);
    if (
      !customer ||
      !status ||
      !product ||
      !Number.isSafeInteger(quantity) ||
      quantity <= 0 ||
      !Number.isSafeInteger(delayDays) ||
      delayDays < 0 ||
      !isValidDate(requestedDate) ||
      !isValidDate(deliveryDate)
    ) {
      throw new Error(`La entrega ${index + 1} tiene datos inválidos.`);
    }

    return {
      id: index + 1,
      customer,
      status,
      product,
      quantity,
      requestedDate,
      deliveryDate,
      delayDays,
    };
  });
}

export function assessDeliveries(
  deliveriesMarkdown,
  inventoryMarkdown,
  { today = getMexicoCityDate() } = {},
) {
  if (!isValidDate(today)) {
    throw new Error("La fecha de referencia de las entregas no es válida.");
  }

  const inventory = parseInventory(inventoryMarkdown);
  const deliveries = parseDeliveryRows(deliveriesMarkdown);
  const remainingBySku = new Map(
    [...inventory.values()].map(({ sku, quantity }) => [sku, quantity]),
  );
  const assessed = new Map();

  const outstanding = deliveries
    .filter(({ status }) => normalizeText(status) !== "entregado")
    .sort(
      (first, second) =>
        first.deliveryDate.localeCompare(second.deliveryDate) ||
        first.requestedDate.localeCompare(second.requestedDate) ||
        first.id - second.id,
    );

  for (const delivery of outstanding) {
    const stock = inventory.get(normalizeText(delivery.product));
    if (!stock) {
      assessed.set(delivery.id, {
        ...delivery,
        sku: null,
        inventoryQuantity: null,
        inventoryUpdatedAt: null,
        availableForOrder: null,
        allocatedQuantity: 0,
        shortage: null,
        fulfillment: "unknown",
      });
      continue;
    }

    const availableForOrder = remainingBySku.get(stock.sku) ?? 0;
    const allocatedQuantity = Math.min(availableForOrder, delivery.quantity);
    const shortage = delivery.quantity - allocatedQuantity;
    remainingBySku.set(stock.sku, availableForOrder - allocatedQuantity);
    assessed.set(delivery.id, {
      ...delivery,
      sku: stock.sku,
      inventoryQuantity: stock.quantity,
      inventoryUpdatedAt: stock.updatedAt,
      availableForOrder,
      allocatedQuantity,
      shortage,
      fulfillment: shortage === 0 ? "ready" : "shortage",
    });
  }

  const records = deliveries.map((delivery) => {
    if (normalizeText(delivery.status) === "entregado") {
      const stock = inventory.get(normalizeText(delivery.product));
      return {
        ...delivery,
        sku: stock?.sku ?? null,
        inventoryQuantity: stock?.quantity ?? null,
        inventoryUpdatedAt: stock?.updatedAt ?? null,
        availableForOrder: null,
        allocatedQuantity: delivery.quantity,
        shortage: 0,
        fulfillment: "delivered",
      };
    }

    return assessed.get(delivery.id);
  });

  const inventoryReferenceDate = parseReferenceDate(inventoryMarkdown);
  const deliveriesReferenceDate = parseReferenceDate(deliveriesMarkdown);
  if (!inventoryReferenceDate) {
    throw new Error("El inventario no incluye una fecha de referencia válida.");
  }
  if (!deliveriesReferenceDate) {
    throw new Error("El registro de entregas no incluye una fecha de referencia válida.");
  }

  return {
    referenceDate: today,
    inventoryReferenceDate,
    deliveriesReferenceDate,
    fictional:
      /información ficticia/i.test(inventoryMarkdown) ||
      /información ficticia/i.test(deliveriesMarkdown),
    counts: {
      delivered: records.filter(({ fulfillment }) => fulfillment === "delivered").length,
      ready: records.filter(({ fulfillment }) => fulfillment === "ready").length,
      shortage: records.filter(({ fulfillment }) => fulfillment === "shortage").length,
      unknown: records.filter(({ fulfillment }) => fulfillment === "unknown").length,
    },
    records,
  };
}

export async function loadDeliveryReadiness(options) {
  const [deliveriesMarkdown, inventoryMarkdown] = await Promise.all([
    readFile(deliveriesFilePath, "utf8"),
    readFile(inventoryFilePath, "utf8"),
  ]);
  return assessDeliveries(deliveriesMarkdown, inventoryMarkdown, options);
}
