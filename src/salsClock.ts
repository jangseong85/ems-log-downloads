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
  cycle: "압박 구간 시작",
  rhythm: "리듬 분석",
  shock: "제세동",
  epi: "Epinephrine 투여",
  amio: "Amiodarone 투여",
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
export function epinephrineProgress(elapsed: number) {
  const duration = Math.max(0, elapsed);
  return {
    progress: Math.min(1, duration / 300000),
    window:
      duration < 180000 ? "before" : duration <= 300000 ? "reference" : "after",
  } as const;
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
  let state: "idle" | "cpr" | "waiting" | "analysis" | "rosc" | "rearrest" =
    "idle";
  const close = (at: number) => {
    if (started !== null) total += Math.min(120000, Math.max(0, at - started));
    started = null;
  };
  for (const event of events) {
    if (event.kind === "cpr") {
      if (started === null) started = event.at;
      state = "cpr";
    } else if (event.kind === "cycle" && started !== null) {
      close(event.at);
      started = event.at;
      cycle = event.at;
      state = "cpr";
    } else if (event.kind === "cycle" && state !== "rosc") {
      started = event.at;
      cycle = event.at;
      state = "cpr";
    } else if (event.kind === "rhythm") {
      close(event.at);
      cycle = null;
      state = "analysis";
    } else if (event.kind === "rosc") {
      close(event.at);
      cycle = null;
      state = "rosc";
    } else if (event.kind === "rearrest") {
      close(event.at);
      cycle = null;
      state = "rearrest";
    }
  }
  return {
    state:
      state === "cpr" && started !== null && now - started >= 120000
        ? "waiting"
        : state,
    total:
      total +
      (started === null ? 0 : Math.min(120000, Math.max(0, now - started))),
    cycleRemaining: cycle === null ? null : Math.max(0, 120000 - (now - cycle)),
    cycleCount: events.filter((e) => e.kind === "cycle").length,
  };
}

/** Manual event-based durations, not a compression sensor measurement. */
export function eventDuration(
  events: SalsEvent[],
  event: SalsEvent,
  now: number,
): number | null {
  const index = events.findIndex((e) => e.id === event.id);
  const after = events.slice(index + 1);
  if (event.kind === "cycle") {
    const end = after.find((e) =>
      ["cycle", "cpr", "rhythm", "rosc", "rearrest"].includes(e.kind),
    );
    return Math.min(120000, Math.max(0, (end?.at ?? now) - event.at));
  }
  if (event.kind === "rosc" || event.kind === "rearrest") {
    const end = after.find((e) => e.kind === "rosc" || e.kind === "rearrest");
    return Math.max(0, (end?.at ?? now) - event.at);
  }
  return null;
}
