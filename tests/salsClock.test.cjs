/* global __dirname */
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
const {
  deriveClock,
  elapsedText,
  parseClock,
  epinephrineProgress,
  eventDuration,
  resetRhythms,
} = moduleValue.exports;
test("epinephrine reference ring respects 3–5 minute boundaries without repeating", () => {
  assert.equal(epinephrineProgress(179000).window, "before");
  assert.equal(epinephrineProgress(180000).window, "reference");
  assert.equal(epinephrineProgress(300000).window, "reference");
  assert.equal(epinephrineProgress(301000).window, "after");
  assert.equal(epinephrineProgress(600000).progress, 1);
  assert.equal(epinephrineProgress(-1000).progress, 0);
});
const event = (kind, at) => ({ id: `${kind}-${at}`, kind, at });
test("rhythm reset preserves compression boundaries and survives serialization", () => {
  const events = [
    event("cpr", 0),
    event("cycle", 0),
    { ...event("rhythm", 60000), detail: "VF" },
    event("cpr", 90000),
    event("cycle", 90000),
  ];
  const reset = JSON.parse(JSON.stringify(resetRhythms(events)));
  assert.deepEqual(deriveClock(reset, 100000), deriveClock(events, 100000));
  assert.equal(deriveClock(reset, 100000).total, 70000);
  assert.equal(reset.filter((e) => e.kind === "rhythm" && !e.hidden).length, 0);
  assert.equal(reset[2].detail, undefined);
  assert.deepEqual(resetRhythms(reset), resetRhythms(events));
});
test("manual CPR time change immediately changes elapsed", () => {
  assert.equal(deriveClock([event("cpr", 10000)], 70000).total, 60000);
  assert.equal(deriveClock([event("cpr", 20000)], 70000).total, 50000);
});
test("rhythm closes compression while medication does not restart it", () => {
  const events = [
    event("cpr", 1000),
    event("cycle", 1000),
    event("rhythm", 10000),
    event("epi", 20000),
  ];
  const value = deriveClock(events, 31000);
  assert.equal(value.total, 9000);
  assert.equal(value.cycleRemaining, null);
  assert.equal(value.state, "analysis");
  assert.equal(events.filter((e) => e.kind === "shock").length, 0);
});
test("undo ROSC restores the running CPR clock", () => {
  const events = [
    event("cpr", 1000),
    event("cycle", 1000),
    event("rosc", 61000),
  ];
  assert.equal(deriveClock(events.slice(0, -1), 91000).total, 90000);
});
test("background return uses timestamps, not tick count", () => {
  const events = [event("cpr", 1000), event("cycle", 1000)];
  assert.equal(deriveClock(events, 181000).total, 120000);
  assert.equal(deriveClock(events, 181000).cycleRemaining, 0);
  assert.equal(deriveClock(events, 181000).state, "waiting");
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
  assert.equal(value.total, 120000);
  assert.equal(value.cycleRemaining, null);
});
test("manual restart after expired interval excludes the gap", () => {
  const events = [
    event("cpr", 1000),
    event("cycle", 1000),
    event("cycle", 151000),
  ];
  const value = deriveClock(events, 181000);
  assert.equal(value.total, 150000);
  assert.equal(value.cycleCount, 2);
  assert.equal(value.cycleRemaining, 90000);
  assert.equal(eventDuration(events, events[1], 181000), 120000);
});
test("rhythm pause is excluded until a manual compression restart", () => {
  const events = [
    event("cpr", 1000),
    event("cycle", 1000),
    event("rhythm", 61000),
    event("cycle", 71000),
  ];
  assert.equal(deriveClock(events, 101000).total, 90000);
  assert.equal(eventDuration(events, events[1], 101000), 60000);
});
test("previous ROSC and re-arrest durations remain fixed across repeated ROSC", () => {
  const events = [
    event("rosc", 1000),
    event("rearrest", 31000),
    event("cpr", 41000),
    event("cycle", 41000),
    event("rosc", 71000),
  ];
  assert.equal(eventDuration(events, events[0], 101000), 30000);
  assert.equal(eventDuration(events, events[1], 101000), 40000);
  assert.equal(eventDuration(events, events[4], 101000), 30000);
  assert.equal(deriveClock(events, 101000).total, 30000);
  assert.equal(deriveClock(events, 101000).state, "rosc");
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
