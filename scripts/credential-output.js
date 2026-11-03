export function assertCredentialOutputAllowed({
  isTTY = process.stdout.isTTY,
  revealRequested = process.argv.includes("--reveal-credentials"),
} = {}) {
  if (!isTTY || !revealRequested) {
    throw new Error(
      "No se modificaron cuentas: usa --reveal-credentials solo desde una terminal privada y autorizada.",
    );
  }
}
