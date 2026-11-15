import { test } from "node:test";
import assert from "node:assert/strict";
import { outcome, analyse, SAMPLES, SITES } from "../public/sim.js";
const shar = SITES[0], vbg = SITES.find((s) => s.id === "vandenberg");
const S = (...ids) => ids.map((x) => (typeof x === "string" ? { id: x } : x));
const code = (st, site = shar) => { const o = outcome(st, site); return o.ok ? "ok" : o.fail.code; };

test("sample rockets", () => {
  assert.equal(code(SAMPLES.good), "ok");
  assert.equal(code(SAMPLES.good, vbg), "ok", "good rocket also works from a polar site");
  assert.equal(code(SAMPLES.moon), "ok");
  assert.equal(code(SAMPLES.mars), "ok");
  assert.equal(code(SAMPLES.mars, vbg), "lowDv", "Mars needs Earth's spin: a polar launch falls short");
  assert.equal(code(SAMPLES.moon.map((x) => (x.id === "moonprobe" ? { id: "marsprobe" } : x))), "lowDv", "the Moon rocket can't reach Mars");
  assert.notEqual(code(SAMPLES.broken), "ok");
});
test("every failure is reachable", () => {
  const g = SAMPLES.good;
  assert.equal(code([]), "empty");
  assert.equal(code(S("nose", "commsat", "solar", "tankXL", "fins")), "noEngine");
  assert.equal(code(S("nose", "commsat", "solar", "engineB", "tankXL", "fins")), "noFuel");
  assert.equal(code(S("nose", "commsat", "solar", "tankL", "engineV", "decoupler", "tankXL", "engineV", "fins")), "noLift");
  assert.equal(code(S("nose", "commsat", "solar", "tankL", "engineV", "decoupler", "tankXL", "tankL", "engineB", "fins")), "tooHeavy");
  assert.equal(code(g.filter((x) => x.id !== "fins")), "unstable");
  assert.equal(code(g.filter((x) => x.id !== "nose")), "noNose");
  assert.equal(code(g.filter((x) => x.id !== "decoupler")), "noDecoupler");
  assert.equal(code(S("nose", "commsat", "solar", "engineV", "tankL", "decoupler", "tankXL", "engineB", "fins")), "upperNoFuel");
  assert.equal(code(S("nose", "commsat", "solar", "tankXL", "engineB", "fins")), "lowDv");
  assert.equal(code(S("nose", "tankL", "engineV", "decoupler", "tankXL", "engineB", "fins")), "noPayload");
  assert.equal(code(S("nose", "solar", "tankL", "engineV", "decoupler", "commsat", "tankXL", "engineB", "fins")), "payloadDropped");
  assert.equal(code(g.filter((x) => x.id !== "solar")), "noPower");
  assert.equal(code(S("nose", "moonprobe", "solar", "tankL", "engineV", "decoupler", "tankXL", "engineB", "fins")), "lowDv", "the earth-orbit rocket can't reach the Moon");
});
test("numbers are sensible", () => {
  const a = analyse(SAMPLES.good, shar);
  assert.ok(a.twr > 1.2 && a.twr < 2, "twr " + a.twr);
  assert.ok(a.dv > 9000 && a.dv < 11000, "dv " + a.dv);
  assert.ok(a.bonus > 400 && a.bonus < 465);
  assert.equal(analyse(SAMPLES.good, vbg).bonus, 0);
});
