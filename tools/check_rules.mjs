// node tools/check_rules.mjs — autoteste do motor de regras e da soma de custo do mês
import assert from "node:assert/strict";
import { enforceTurnRules } from "../src/rules.js";
import { sumModels } from "../src/config.js";

const player = { level: 10, xpToNext: 200 };
const p = { xpDelta: 9999, setLevel: 50, hpMaxDelta: -80, manaMaxDelta: 20, attributeDeltas: { forca: 12, agi: -9, int: 3 } };
const cuts = enforceTurnRules(p, player);
assert.equal(p.xpDelta, 300);
assert.equal(p.setLevel, 11);
assert.equal(p.hpMaxDelta, -50);
assert.equal(p.manaMaxDelta, 20);
assert.deepEqual(p.attributeDeltas, { forca: 5, agi: -5, int: 3 });
assert.equal(cuts.length, 5);
assert.deepEqual(enforceTurnRules({ xpDelta: 10 }, player), []);
assert.deepEqual(enforceTurnRules(null, player), []);

assert.deepEqual(
  sumModels([{ a: { req: 1, in: 10, out: 5 } }, null, { a: { req: 2, in: 1, out: 1 }, b: { req: 1, in: 0, out: 3 } }]),
  { a: { req: 3, in: 11, out: 6 }, b: { req: 1, in: 0, out: 3 } }
);
console.log("ok");
