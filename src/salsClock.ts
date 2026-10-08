export type EventKind =
  "cpr" | "cycle" | "rhythm" | "shock" | "epi" | "amio" | "rosc" | "rearrest";
export type SalsEvent = {
  id: string;
  kind: EventKind;
  at: number;
  detail?: string;
};
export const eventLabels: Record<EventKind, string> = {
  cpr: "CPR 시작",
  cycle: "사이클 시작",
  rhythm: "리듬 분석",
  shock: "제세동",
  epi: "에피 투여",
  amio: "아미오다론 투여",
  rosc: "ROSC",
  rearrest: "재심정지",
};
export function clockText(at: number): string {
  const d = new Date(at);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");
}
export function elapsedText(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return [
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
    seconds % 60,
  ]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");
}
// Keep the original date internally, including a session spanning midnight.
export function parseClock(text: string, original: number): number | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(text)) return null;
  const [h, m, s] = text.split(":").map(Number) as [number, number, number];
  const d = new Date(original);
  d.setHours(h, m, s, 0);
  return d.getTime();
}
export function deriveClock(events: SalsEvent[], now: number) {
  let total = 0;
  let started: number | null = null;
  let cycle: number | null = null;
  let state: "idle" | "cpr" | "rosc" | "rearrest" = "idle";
  for (const event of events) {
    if (event.kind === "cpr") {
      if (started === null) started = event.at;
      state = "cpr";
    } else if (event.kind === "cycle" && started !== null) {
      cycle = event.at;
    } else if (event.kind === "rosc") {
      if (started !== null) total += Math.max(0, event.at - started);
      started = null;
      cycle = null;
      state = "rosc";
    } else if (event.kind === "rearrest") {
      state = "rearrest";
    }
  }
  return {
    state,
    total: total + (started === null ? 0 : Math.max(0, now - started)),
    cycleRemaining: cycle === null ? null : Math.max(0, 120000 - (now - cycle)),
    cycleCount: events.filter((e) => e.kind === "cycle").length,
  };
}
