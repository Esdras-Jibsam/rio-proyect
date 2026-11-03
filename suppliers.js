import { readFile } from "node:fs/promises";
import path from "node:path";

const supplierFilePath = path.join(
  import.meta.dirname,
  "Documentos",
  "Proveedores.md",
);
const mexicoCityTimeZone = "America/Mexico_City";
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

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

function daysBetween(firstDate, secondDate) {
  const first = Date.parse(`${firstDate}T00:00:00Z`);
  const second = Date.parse(`${secondDate}T00:00:00Z`);
  return Math.round((second - first) / 86_400_000);
}

export function parseSupplierPayments(markdown, { today = getMexicoCityDate() } = {}) {
  if (!isValidDate(today)) {
    throw new Error("La fecha de referencia del reporte no es válida.");
  }

  const rows = markdown
    .split(/\r?\n/)
    .filter((line) => line.includes("\t"))
    .map((line) => line.split("\t").map((value) => value.trim()))
    .filter(([supplier]) => supplier && supplier !== "Proveedor (razón social)");

  const records = rows.map((columns, index) => {
    if (columns.length < 7) {
      throw new Error(`El registro de proveedor ${index + 1} está incompleto.`);
    }

    const [supplier, amount, description, , issuedDate, dueDate, paidDate = ""] =
      columns;
    if (
      !supplier ||
      !isValidDate(issuedDate) ||
      !isValidDate(dueDate) ||
      (paidDate && !isValidDate(paidDate))
    ) {
      throw new Error(`El registro de proveedor ${index + 1} tiene datos inválidos.`);
    }

    const parsedAmount = Number(amount.replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(parsedAmount)) {
      throw new Error(`El registro de proveedor ${index + 1} tiene un importe inválido.`);
    }

    const status = paidDate ? "paid" : dueDate < today ? "overdue" : "pending";
    return {
      id: index + 1,
      supplier,
      amount: parsedAmount,
      description,
      issuedDate,
      dueDate,
      paidDate: paidDate || null,
      status,
      daysUntilDue: status === "pending" ? daysBetween(today, dueDate) : null,
    };
  });

  return {
    referenceDate: today,
    fictional: /información ficticia/i.test(markdown),
    counts: {
      paid: records.filter(({ status }) => status === "paid").length,
      pending: records.filter(({ status }) => status === "pending").length,
      overdue: records.filter(({ status }) => status === "overdue").length,
    },
    records,
  };
}

export async function loadSupplierPayments(options) {
  const markdown = await readFile(supplierFilePath, "utf8");
  return parseSupplierPayments(markdown, options);
}
