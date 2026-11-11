// node tools/check_injuries.mjs — autoteste da Fase 5.7 (HP %, lesões, armadura, sistema mágico)
import assert from "node:assert/strict";
import { applyStatePatches, createInitialGameData } from "../src/state.js";

const game = createInitialGameData();
game.spheres = game.spheres || {};
game.compendium = game.compendium || { npcs: [], bestiary: [], concepts: [] };
applyStatePatches(game, {
  hpDelta: -12, hpMaxDelta: 50, armor: 6.4,
  injuryUpdates: [{ region: "braco_esq", severity: 40, effect: "-3 precisão" }, { region: "", severity: 9 }],
  magicSystemPatch: { laws: ["mana conserva energia"] }
});
const p = game.core.player;
assert.equal(p.hpMax, 100); // hpMaxDelta ignorado
assert.equal(p.hp, 88);
assert.equal(p.armor, 6);
assert.deepEqual(p.injuries, { braco_esq: { severity: 40, effect: "-3 precisão" } });
assert.deepEqual(game.core.magicSystem.laws, ["mana conserva energia"]);
applyStatePatches(game, { injuryUpdates: [{ region: "braco_esq", severity: 0 }] });
assert.deepEqual(p.injuries, {});
console.log("ok");
