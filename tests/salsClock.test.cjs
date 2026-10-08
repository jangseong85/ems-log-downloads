const { test } = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const fs = require("node:fs");
const path = require("node:path");
const moduleValue = { exports: {} };
const source = fs.readFileSync(
  path.join(__dirname, "../src/salsClock.ts"),
  "utf8",
);
new Function(
  "exports",
  "module",
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
)(moduleValue.exports, moduleValue);
const { deriveClock, elapsedText, parseClock } = moduleValue.exports;
const event = (kind, at) => ({ id: `${kind}-${at}`, kind, at });
test("manual CPR time change immediately changes elapsed", () => {
  assert.equal(deriveClock([event("cpr", 10000)], 70000).total, 60000);
  assert.equal(deriveClock([event("cpr", 20000)], 70000).total, 50000);
});
test("rhythm and medication events do not alter CPR or cycle timing", () => {
  const events = [event("cpr", 1000), event("cycle", 1000), event("rhythm", 10000), event("epi", 20000)];
  const value = deriveClock(events, 31000);
  assert.equal(value.total, 30000);
  assert.equal(value.cycleRemaining, 90000);
  assert.equal(events.filter(e => e.kind === "shock").length, 0);
});
test("undo ROSC restores the running CPR clock", () => {
  const events = [event("cpr", 1000), event("cycle", 1000), event("rosc", 61000)];
  assert.equal(deriveClock(events.slice(0, -1), 91000).total, 90000);
});
test("background return uses timestamps, not tick count", () => {
  const events = [event("cpr", 1000), event("cycle", 1000)];
  assert.equal(deriveClock(events, 181000).total, 180000);
  assert.equal(deriveClock(events, 181000).cycleRemaining, 0);
});
test("ROSC stops CPR and re-arrest requires explicit resume", () => {
  const events = [
    event("cpr", 1000),
    event("cycle", 1000),
    event("rosc", 61000),
    event("rearrest", 91000),
  ];
  assert.equal(deriveClock(events, 121000).total, 60000);
  assert.equal(deriveClock(events, 121000).state, "rearrest");
  assert.equal(
    deriveClock(
      [...events, event("cpr", 121000), event("cycle", 121000)],
      151000,
    ).total,
    90000,
  );
});
test("next cycle preserves total and previous cycles", () => {
  const value = deriveClock(
    [event("cpr", 1000), event("cycle", 1000), event("cycle", 121000)],
    151000,
  );
  assert.equal(value.total, 150000);
  assert.equal(value.cycleRemaining, 90000);
  assert.equal(value.cycleCount, 2);
});
test("cycle reset does not reset CPR", () => {
  const value = deriveClock([event("cpr", 1000)], 151000);
  assert.equal(value.total, 150000);
  assert.equal(value.cycleRemaining, null);
});
test("24-hour manual input preserves date and rejects invalid input", () => {
  const original = new Date(2026, 9, 8, 23, 0, 0).getTime();
  assert.equal(new Date(parseClock("22:59:30", original)).getDate(), 8);
  assert.equal(parseClock("24:00:00", original), null);
  assert.equal(parseClock("12:60:00", original), null);
});
test("elapsed includes midnight and hours without wrapping", () => {
  assert.equal(elapsedText(3661000), "01:01:01");
  const start = new Date(2026, 9, 8, 23, 59, 30).getTime();
  const end = new Date(2026, 9, 9, 0, 0, 30).getTime();
  assert.equal(deriveClock([event("cpr", start)], end).total, 60000);
});
