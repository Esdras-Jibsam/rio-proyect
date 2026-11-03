import assert from "node:assert/strict";
import { test } from "node:test";
import { assertCredentialOutputAllowed } from "../scripts/credential-output.js";

test("refuses credential output unless explicitly enabled in a TTY", () => {
  assert.throws(
    () => assertCredentialOutputAllowed({ isTTY: false, revealRequested: true }),
    /No se modificaron cuentas/,
  );
  assert.throws(
    () => assertCredentialOutputAllowed({ isTTY: true, revealRequested: false }),
    /No se modificaron cuentas/,
  );
  assert.doesNotThrow(
    () => assertCredentialOutputAllowed({ isTTY: true, revealRequested: true }),
  );
});
