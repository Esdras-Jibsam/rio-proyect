import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createWorker } from "tesseract.js";

const require = createRequire(import.meta.url);
const spanishDataPath = join(
  dirname(require.resolve("@tesseract.js-data/spa")),
  "4.0.0_best_int",
);
const minimumConfidence = 0.8;
const maxInvoicePages = 20;
const maxImageDimension = 3000;
const maxPdfPixels = 16_000_000;
const requiredInvoiceFields = [
  ["invoiceNumber", "Folio"],
  ["issueDate", "Fecha"],
  ["vendorName", "Proveedor"],
  ["total", "Total"],
];

function createInvoiceFields() {
  return {
    invoiceNumber: null,
    issueDate: null,
    dueDate: null,
    vendorName: null,
    vendorTaxId: null,
    customerName: null,
    customerTaxId: null,
    subtotal: null,
    tax: null,
    total: null,
    amountDue: null,
    items: [],
  };
}

function parseAmount(value) {
  if (typeof value !== "string") {
    return null;
  }

  let normalized = value.replace(/[^\d.,-]/g, "");
  const lastComma = normalized.lastIndexOf(",");
  const lastPeriod = normalized.lastIndexOf(".");
  if (lastComma !== -1 && lastPeriod !== -1) {
    const decimalSeparator = lastComma > lastPeriod ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    normalized = normalized
      .replaceAll(thousandsSeparator, "")
      .replace(decimalSeparator, ".");
  } else if (lastComma !== -1) {
    normalized =
      /,\d{1,2}$/.test(normalized)
        ? normalized.replace(",", ".")
        : normalized.replaceAll(",", "");
  } else if (lastPeriod !== -1 && /\.\d{3}$/.test(normalized)) {
    normalized = normalized.replace(".", "");
  }

  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function parseDate(value) {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.match(
    /^\s*(?:(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})|(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4}))\s*$/,
  );
  if (!match) {
    return null;
  }

  const year = Number(match[1] ?? match[6]);
  const month = Number(match[2] ?? match[5]);
  const day = Number(match[3] ?? match[4]);
  const fullYear = year < 100 ? 2000 + year : year;
  const date = new Date(Date.UTC(fullYear, month - 1, day));
  if (
    date.getUTCFullYear() !== fullYear ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${fullYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getLabeledValue(text, pattern) {
  return text.match(pattern)?.[1]?.trim() ?? null;
}

function getAmount(text, labelPattern, currencyCode) {
  const rawAmount = getLabeledValue(
    text,
    new RegExp(
      `(?:^|\\b)(?:${labelPattern})\\s*[:=]?\\s*([$]?\\s*[\\d][\\d.,]*)`,
      "im",
    ),
  );
  const amount = parseAmount(rawAmount);
  return amount === null ? null : { amount, currencyCode };
}

function getInvoiceItems(text, currencyCode) {
  const items = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(
      /^\s*([A-Z0-9][A-Z0-9._/-]{1,})\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s+([\d.,]+)\s+([\d.,]+)\s*$/i,
    );
    if (!match) {
      continue;
    }

    const quantity = parseAmount(match[3]);
    const unitPrice = parseAmount(match[4]);
    const amount = parseAmount(match[5]);
    if (quantity === null || unitPrice === null || amount === null) {
      continue;
    }

    items.push({
      productCode: match[1],
      description: match[2].trim(),
      quantity,
      unitPrice: { amount: unitPrice, currencyCode },
      amount: { amount, currencyCode },
    });
  }
  return items;
}

function extractInvoice(text, confidence) {
  const invoice = createInvoiceFields();
  const currencyCode = text.match(/\b(MXN|USD|EUR)\b/i)?.[1]?.toUpperCase() ?? null;
  invoice.invoiceNumber = getLabeledValue(
    text,
    /(?:^|\b)(?:folio|no\.?\s*(?:de\s*)?factura|factura\s*(?:no\.?|n[uú]mero|#))\s*[:#-]?\s*([A-Z0-9][A-Z0-9./-]{1,})/im,
  );
  invoice.issueDate = parseDate(
    getLabeledValue(
      text,
      /(?:^|\b)fecha(?:\s+de\s+(?:emisi[oó]n|factura))?\s*[:#-]?\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/im,
    ),
  );
  invoice.dueDate = parseDate(
    getLabeledValue(
      text,
      /(?:^|\b)(?:vence|fecha\s+de\s+vencimiento|vencimiento)\s*[:#-]?\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/im,
    ),
  );
  const vendorMatch = text.match(
    /(?:^|\b)(?:proveedor|emisor|raz[oó]n social)\s*:?\s*([^\r\n]+)/im,
  );
  const firstRfcIndex = text.search(/\bRFC\s*:/i);
  if (vendorMatch) {
    invoice.vendorName = vendorMatch[1]
      .split(/\b(?:RFC|fecha|folio|tel(?:[eé]fono)?|factura)\s*:/i)[0]
      .trim() || null;
  } else if (firstRfcIndex !== -1) {
    const vendorLines = text
      .slice(0, firstRfcIndex)
      .split(/\r?\n/)
      .map((line) => line.replace(/\bFACTURA\b.*$/i, "").trim())
      .filter((line) => line && !/^(?:factura|folio)$/i.test(line));
    invoice.vendorName = vendorLines.at(-1) ?? null;
  }

  const rfcMatches = [...text.matchAll(/\bRFC\s*:\s*([A-Z&Ñ]{3,4}\s*\d{6}\s*[A-Z0-9]{3})/gi)]
    .map((match) => match[1].replace(/\s/g, "").toUpperCase());
  invoice.vendorTaxId = rfcMatches[0] ?? null;
  invoice.customerTaxId = rfcMatches[1] ?? null;

  const customerSection = text.match(/\bCLIENTE\b\s*:?\s*([\s\S]{1,160})/i)?.[1];
  if (customerSection) {
    invoice.customerName =
      customerSection
        .split(/\b(?:RFC|Sucursal|Orden\s+de\s+compra|Condiciones)\b/i)[0]
        .replace(/\s+/g, " ")
        .trim() || null;
  }

  invoice.subtotal = getAmount(
    text,
    "sub\\s*total|importe\\s+antes\\s+de\\s+impuestos",
    currencyCode,
  );
  invoice.tax = getAmount(
    text,
    "IVA(?:\\s*\\d+(?:[.,]\\d+)?\\s*%)?|impuestos?",
    currencyCode,
  );
  invoice.total = getAmount(
    text,
    "total(?:\\s+(?:MXN|USD|EUR))?|importe\\s+total",
    currencyCode,
  );
  invoice.amountDue =
    getAmount(text, "saldo(?:\\s+pendiente)?|importe\\s+(?:pendiente|debido)", currencyCode) ??
    invoice.total;
  invoice.items = getInvoiceItems(text, currencyCode);

  return {
    invoice,
    confidence: Object.fromEntries(
      Object.keys(invoice)
        .filter((key) => key !== "items")
        .map((key) => [key, invoice[key] ? confidence : null]),
    ),
  };
}

function buildInvoiceAnalysis({
  invoice: extractedInvoice,
  confidence = {},
  pageCount = null,
}) {
  const invoice = { ...createInvoiceFields(), ...extractedInvoice };
  const checks = [];
  const missingFields = requiredInvoiceFields.filter(([key]) => !invoice[key]);
  if (missingFields.length) {
    checks.push({
      status: "review",
      label: "Campos requeridos",
      message: `Revisión manual: no se identificó ${missingFields
        .map(([, label]) => label)
        .join(", ")}.`,
    });
  } else {
    checks.push({
      status: "passed",
      label: "Campos requeridos",
      message: "Se identificaron folio, fecha, proveedor y total.",
    });
  }

  const lowConfidenceFields = requiredInvoiceFields
    .filter(([key]) => (confidence[key] ?? 0) < minimumConfidence)
    .map(([, label]) => label);
  if (lowConfidenceFields.length) {
    checks.push({
      status: "review",
      label: "Confianza de lectura",
      message: `Revisa la lectura de: ${lowConfidenceFields.join(", ")}.`,
    });
  } else {
    checks.push({
      status: "passed",
      label: "Confianza de lectura",
      message: "No se detectaron campos requeridos con baja confianza.",
    });
  }

  let arithmeticMismatch = false;
  if (invoice.subtotal && invoice.tax && invoice.total) {
    arithmeticMismatch =
      Math.abs(
        invoice.subtotal.amount + invoice.tax.amount - invoice.total.amount,
      ) > 0.02;
    checks.push({
      status: arithmeticMismatch ? "failed" : "passed",
      label: "Consistencia de importes",
      message: arithmeticMismatch
        ? "La suma de subtotal e impuestos no coincide con el total detectado."
        : "Subtotal más impuestos coincide con el total detectado.",
    });
  } else {
    checks.push({
      status: "review",
      label: "Consistencia de importes",
      message: "No se pudo comprobar la suma: falta subtotal, impuesto o total.",
    });
  }

  const hasReviewChecks = checks.some(({ status }) => status === "review");
  const status =
    arithmeticMismatch || checks.some(({ status }) => status === "failed")
      ? "invalid"
      : missingFields.length || lowConfidenceFields.length || hasReviewChecks
        ? "review"
        : "valid";
  return {
    model: "Tesseract.js + PDF.js (local)",
    status,
    label: {
      valid: "Consistente en validación preliminar",
      review: "Requiere revisión manual",
      invalid: "Importes inconsistentes",
    }[status],
    invoice,
    checks,
    disclaimer:
      "Extracción y validación preliminar ejecutadas localmente; no valida CFDI ante el SAT ni sustituye una revisión contable.",
    pageCount,
  };
}

async function createOcrWorker() {
  return createWorker("spa", 1, {
    langPath: spanishDataPath,
    cacheMethod: "none",
    gzip: true,
  });
}

async function recognizeImage(buffer, getWorker) {
  const image = await loadImage(buffer);
  const scale = Math.min(
    1,
    maxImageDimension / image.width,
    maxImageDimension / image.height,
  );
  const canvas = createCanvas(
    Math.max(1, Math.round(image.width * scale)),
    Math.max(1, Math.round(image.height * scale)),
  );
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  const result = await (await getWorker()).recognize(canvas.toBuffer("image/png"));
  return {
    text: result.data.text,
    confidence: Number.isFinite(result.data.confidence)
      ? result.data.confidence / 100
      : 0,
  };
}

async function extractPdfPages(buffer, getWorker) {
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: true,
  });
  try {
    const pdf = await loadingTask.promise;
    if (pdf.numPages > maxInvoicePages) {
      throw new Error(
        `El documento supera el límite local de ${maxInvoicePages} páginas.`,
      );
    }

    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const embeddedText = content.items
        .map((item) => `${item.str}${item.hasEOL ? "\n" : " "}`)
        .join("")
        .trim();
      if (embeddedText.length >= 40) {
        pages.push({ text: embeddedText, confidence: 0.99 });
        continue;
      }

      const initialViewport = page.getViewport({ scale: 1.75 });
      const scale = Math.min(
        1.75,
        Math.sqrt(maxPdfPixels / (initialViewport.width * initialViewport.height)),
      );
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      await page.render({
        canvasContext: canvas.getContext("2d"),
        viewport,
      }).promise;
      pages.push(
        await recognizeImage(canvas.toBuffer("image/png"), getWorker),
      );
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}

export function validateInvoiceAnalysis(extractedInvoice) {
  return buildInvoiceAnalysis(extractedInvoice);
}

export function createInvoiceAnalyzer() {
  return async function analyzeInvoice({ buffer, contentType }) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error("No se recibió un archivo de factura válido.");
    }

    let worker;
    const getWorker = async () => {
      worker ??= await createOcrWorker();
      return worker;
    };

    try {
      const isPdf =
        contentType === "application/pdf" ||
        buffer.subarray(0, 5).equals(Buffer.from("%PDF-"));
      const pages = isPdf
        ? await extractPdfPages(buffer, getWorker)
        : [await recognizeImage(buffer, getWorker)];
      const text = pages.map(({ text: pageText }) => pageText).join("\n");
      const confidence =
        pages.reduce((total, page) => total + page.confidence, 0) / pages.length;
      const extracted = extractInvoice(text, confidence);
      return validateInvoiceAnalysis({
        ...extracted,
        pageCount: pages.length,
      });
    } finally {
      await worker?.terminate();
    }
  };
}
