import assert from "node:assert/strict";
import { test } from "node:test";
import { buildInventoryInstructions } from "../scripts/inventory.js";

test("las instrucciones del agente incluyen el inventario y advierten que es ficticio", async () => {
  const instructions = await buildInventoryInstructions();

  assert.match(instructions, /información ficticia de ejemplo/i);
  assert.match(instructions, /no a disponibilidad en tiempo real/i);
  assert.match(instructions, /31 de octubre de 2026/);
  assert.match(instructions, /LIM-001\s+Detergente líquido industrial/);
  assert.match(instructions, /HIG-003\s+Papel higiénico jumbo/);
  assert.match(instructions, /SEG-002\s+Mandil impermeable/);
  assert.match(instructions, /145\s+2026-10-31/);
});
