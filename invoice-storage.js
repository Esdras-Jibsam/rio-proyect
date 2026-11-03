import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const invoiceIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:pdf|jpg|jpeg|png)$/i;
const allowedContentTypes = new Map([
  [".pdf", "application/pdf"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
]);

export class DuplicateInvoiceError extends Error {
  constructor(invoice) {
    super("La factura ya está guardada.");
    this.name = "DuplicateInvoiceError";
    this.invoice = invoice;
  }
}

function getSafeFileName(fileName) {
  const safeFileName = path.basename(fileName.replaceAll("\\", "/"));
  return /[\u0000-\u001f\u007f]/.test(safeFileName)
    ? null
    : safeFileName;
}

function normalizeIdentity(value) {
  return typeof value === "string"
    ? value
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .replace(/[^a-zA-Z0-9]/g, "")
        .toUpperCase()
    : "";
}

function getDuplicateKeys(analysis) {
  if (
    !analysis ||
    analysis.checks?.find(({ label }) => label === "Confianza de lectura")
      ?.status !== "passed"
  ) {
    return [];
  }

  const invoice = analysis.invoice;
  const invoiceNumber = normalizeIdentity(invoice?.invoiceNumber);
  if (!invoiceNumber) {
    return [];
  }

  const keys = [];
  const vendorTaxId = normalizeIdentity(invoice.vendorTaxId);
  if (vendorTaxId) {
    keys.push(`rfc:${vendorTaxId}|folio:${invoiceNumber}`);
  }

  const vendorName = normalizeIdentity(invoice.vendorName);
  const issueDate = normalizeIdentity(invoice.issueDate);
  const total = invoice.total?.amount;
  if (
    vendorName &&
    issueDate &&
    typeof total === "number" &&
    Number.isFinite(total)
  ) {
    keys.push(
      `proveedor:${vendorName}|folio:${invoiceNumber}|fecha:${issueDate}|total:${total.toFixed(2)}`,
    );
  }
  return keys;
}

function getContentHash(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function readMetadata(directory, invoiceId) {
  try {
    const metadata = JSON.parse(
      await readFile(path.join(directory, `${invoiceId}.json`), "utf8"),
    );
    return metadata && typeof metadata === "object" ? metadata : null;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export function createLocalInvoiceStorage(directory) {
  const storageDirectory = path.resolve(directory);
  let pendingWrites = Promise.resolve();

  async function ensureDirectory() {
    await mkdir(storageDirectory, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      await chmod(storageDirectory, 0o700);
    }
  }

  async function withWriteLock(operation) {
    const previousWrite = pendingWrites;
    let releaseWrite;
    pendingWrites = new Promise((resolve) => {
      releaseWrite = resolve;
    });
    await previousWrite;
    try {
      return await operation();
    } finally {
      releaseWrite();
    }
  }

  async function writeInvoiceMetadata(invoiceId, metadata) {
    const metadataPath = path.join(storageDirectory, `${invoiceId}.json`);
    const temporaryPath = `${metadataPath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(metadata), {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, metadataPath);
  }

  return {
    async saveInvoice({ file, extension, analysis, analyzeInvoice }) {
      const contentType = allowedContentTypes.get(extension);
      if (!contentType || file.mimetype !== contentType) {
        throw new Error("El formato de factura no es válido.");
      }

      const invoiceId = `${randomUUID()}${extension}`;
      const filePath = path.join(storageDirectory, invoiceId);
      const metadataPath = path.join(storageDirectory, `${invoiceId}.json`);
      const fileName = getSafeFileName(file.originalname);
      if (!fileName) {
        throw new Error("El nombre de archivo no es válido.");
      }

      return withWriteLock(async () => {
        await ensureDirectory();
        const contentHash = getContentHash(file.buffer);
        const duplicateKeys = getDuplicateKeys(analysis);
        const entries = await readdir(storageDirectory, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isFile() || !invoiceIdPattern.test(entry.name)) {
            continue;
          }

          const existingBuffer = await readFile(
            path.join(storageDirectory, entry.name),
          );
          let metadata = await readMetadata(storageDirectory, entry.name);
          const existingHash =
            metadata?.contentHash ?? getContentHash(existingBuffer);
          let existingKeys = Array.isArray(metadata?.duplicateKeys)
            ? metadata.duplicateKeys
            : [];

          if (!metadata?.contentHash || !Array.isArray(metadata?.duplicateKeys)) {
            if (
              !existingKeys.length &&
              typeof analyzeInvoice === "function" &&
              metadata?.analysisAttempted !== true
            ) {
              try {
                const existingAnalysis = await analyzeInvoice({
                  buffer: existingBuffer,
                  contentType:
                    allowedContentTypes.get(
                      path.extname(entry.name).toLowerCase(),
                    ) ?? "application/octet-stream",
                });
                existingKeys = getDuplicateKeys(existingAnalysis);
                metadata = {
                  ...metadata,
                  duplicateKeys: existingKeys,
                  analysisAttempted: true,
                };
              } catch (error) {
                console.error("No se pudo verificar una factura guardada:", {
                  name: error instanceof Error ? error.name : "Error desconocido",
                });
                metadata = {
                  ...metadata,
                  duplicateKeys: [],
                  analysisAttempted: true,
                };
              }
            }

            metadata = {
              ...metadata,
              contentHash: existingHash,
              duplicateKeys: existingKeys,
            };
            await writeInvoiceMetadata(entry.name, metadata);
          }

          const duplicateKey = duplicateKeys.find((key) =>
            existingKeys.includes(key),
          );
          if (existingHash === contentHash || duplicateKey) {
            const existingName = getSafeFileName(metadata?.fileName);
            throw new DuplicateInvoiceError({
              id: entry.name,
              fileName: existingName ?? entry.name,
              match: existingHash === contentHash ? "contenido" : "datos de factura",
            });
          }
        }

        const metadata = {
          fileName,
          createdAt: new Date().toISOString(),
          contentHash,
          duplicateKeys,
          analysisAttempted: Boolean(analyzeInvoice),
        };
        await writeFile(filePath, file.buffer, { flag: "wx", mode: 0o600 });
        try {
          await writeFile(metadataPath, JSON.stringify(metadata), {
            flag: "wx",
            mode: 0o600,
          });
        } catch (error) {
          await unlink(filePath);
          throw error;
        }

        return invoiceId;
      });
    },

    async listInvoices() {
      await ensureDirectory();
      const entries = await readdir(storageDirectory, { withFileTypes: true });
      const invoices = [];
      for (const entry of entries) {
        if (!entry.isFile() || !invoiceIdPattern.test(entry.name)) {
          continue;
        }

        const filePath = path.join(storageDirectory, entry.name);
        const [fileStat, fileName] = await Promise.all([
          stat(filePath),
          readMetadata(storageDirectory, entry.name),
        ]);
        const safeFileName = getSafeFileName(fileName?.fileName);
        invoices.push({
          id: entry.name,
          fileName: safeFileName ?? entry.name,
          contentType:
            allowedContentTypes.get(path.extname(entry.name).toLowerCase()) ??
            "application/octet-stream",
          createdAt: fileStat.mtime.toISOString(),
        });
      }

      return invoices.sort((first, second) =>
        second.createdAt.localeCompare(first.createdAt),
      );
    },

    async readInvoice(invoiceId) {
      if (typeof invoiceId !== "string" || !invoiceIdPattern.test(invoiceId)) {
        return null;
      }

      try {
        const buffer = await readFile(path.join(storageDirectory, invoiceId));
        return {
          buffer,
          contentType:
            allowedContentTypes.get(path.extname(invoiceId).toLowerCase()) ??
            "application/octet-stream",
        };
      } catch (error) {
        if (error?.code === "ENOENT") {
          return null;
        }
        throw error;
      }
    },
  };
}
