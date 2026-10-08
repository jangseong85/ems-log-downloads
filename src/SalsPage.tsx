import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  AccessibilityInfo,
  Animated,
  AppState,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle } from "react-native-svg";
import {
  clockText,
  deriveClock,
  elapsedText,
  epinephrineProgress,
  eventDuration,
  eventLabels,
  EventKind,
  parseClock,
  resetRhythms,
  SalsEvent,
} from "./salsClock";

const STORAGE = "ems-log.sals-timers.v2";
const rhythms = ["VF", "Pulseless VT", "PEA", "Asystole"];

export default function SalsPage({
  isDark,
  visible,
}: {
  isDark: boolean;
  visible: boolean;
}) {
  const [events, setEvents] = useState<SalsEvent[]>([]);
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [editing, setEditing] = useState<SalsEvent | null>(null);
  const [time, setTime] = useState("");
  const [error, setError] = useState("");
  const [reduceMotion, setReduceMotion] = useState(true);
  const pulse = useRef(new Animated.Value(1)).current;
  const saveQueue = useRef(Promise.resolve());
  const colors = isDark
    ? {
        bg: "#17211E",
        input: "#101916",
        text: "#F0F6F4",
        muted: "#B7C8C3",
        line: "#354741",
        accent: "#67D2BC",
        selected: "#176F60",
      }
    : {
        bg: "#FFFFFF",
        input: "#FAFCFB",
        text: "#17322C",
        muted: "#586A66",
        line: "#DDE5E3",
        accent: "#087F6D",
        selected: "#087F6D",
      };
  useEffect(() => {
    let mounted = true;
    void AsyncStorage.getItem(STORAGE)
      .then((raw) => {
        if (!mounted) return;
        if (!raw) {
          setReady(true);
          return;
        }
        const parsed: unknown = JSON.parse(raw);
        if (
          !Array.isArray(parsed) ||
          !parsed.every(
            (e) =>
              typeof e.id === "string" &&
              Object.hasOwn(eventLabels, e.kind) &&
              Number.isFinite(e.at) &&
              (e.hidden === undefined || typeof e.hidden === "boolean") &&
              (e.detail === undefined || typeof e.detail === "string"),
          )
        )
          throw new Error("Invalid events");
        setEvents((parsed as SalsEvent[]).sort((a, b) => a.at - b.at));
        setReady(true);
      })
      .catch(() => {
        if (mounted)
          Alert.alert(
            "복구 안내",
            "SALS 기록을 불러오지 못했습니다. 기존 기록 보호를 위해 기록 변경을 중단했습니다. 앱을 다시 실행해 주세요.",
          );
      });
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    saveQueue.current = saveQueue.current
      .then(() => AsyncStorage.setItem(STORAGE, JSON.stringify(events)))
      .catch(() => {
        Alert.alert("복구 안내", "현재 SALS 기록의 임시 저장에 실패했습니다.");
      });
  }, [events, ready]);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    refresh();
    const timer = setInterval(refresh, 250);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);
  const snapshot = deriveClock(events, now);
  const preparing =
    snapshot.cycleRemaining !== null &&
    snapshot.cycleRemaining > 0 &&
    snapshot.cycleRemaining <= 10000;
  const cycleColor =
    preparing || snapshot.cycleRemaining === 0
      ? isDark
        ? "#F0C36B"
        : "#8C5B09"
      : colors.accent;
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (mounted) setReduceMotion(value);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    if (!preparing || !visible || reduceMotion) {
      pulse.setValue(1);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.7,
          duration: 650,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 650,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => {
      animation.stop();
      pulse.setValue(1);
    };
  }, [preparing, visible, reduceMotion, pulse]);
  const latest = (kind: EventKind) =>
    events.filter((e) => e.kind === kind && !e.hidden).at(-1);
  const count = (kind: EventKind) =>
    events.filter((e) => e.kind === kind && !e.hidden).length;
  const add = (kind: EventKind, detail?: string) => {
    const at = Date.now();
    setNow(at);
    setEvents((previous) => [
      ...previous,
      { id: `${at}-${Math.random()}`, kind, at, detail },
      ...(kind === "cpr"
        ? [{ id: `${at}-cycle-${Math.random()}`, kind: "cycle" as const, at }]
        : []),
    ]);
  };
  const edit = (event: SalsEvent) => {
    setEditing(event);
    setTime(clockText(event.at));
    setError("");
  };
  const reset = (kind: EventKind) => {
    const linked =
      kind === "cpr"
        ? ["cpr", "cycle", "rosc", "rearrest"]
        : kind === "rosc"
          ? ["rosc", "rearrest"]
          : [kind];
    Alert.alert(
      `${eventLabels[kind]} 리셋`,
      kind === "cpr"
        ? "CPR·사이클·ROSC·재심정지 기록을 지웁니다. 투약·리듬·제세동 기록은 유지됩니다."
        : kind === "rosc"
          ? "ROSC와 재심정지 기록을 지웁니다. CPR 경과가 다시 계산됩니다."
          : `해당 항목의 모든 기록과 횟수를 지울까요? 다른 항목은 유지됩니다.`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "리셋",
          style: "destructive",
          onPress: () =>
            setEvents((previous) =>
              kind === "rhythm"
                ? resetRhythms(previous)
                : previous.filter((e) => !linked.includes(e.kind)),
            ),
        },
      ],
    );
  };
  const text = (value: string, style = styles.body) => (
    <Text style={[style, { color: colors.text }]}>{value}</Text>
  );
  const button = (
    label: string,
    action: () => void,
    disabled = false,
    selected = false,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={!ready || disabled}
      onPress={action}
      style={[
        styles.button,
        {
          backgroundColor: selected ? colors.selected : colors.input,
          borderColor: colors.line,
          opacity: disabled || !ready ? 0.4 : 1,
        },
      ]}
    >
      <Text
        style={[styles.action, { color: selected ? "#FFFFFF" : colors.text }]}
      >
        {label}
      </Text>
    </Pressable>
  );
  const tools = (kind: EventKind) => (
    <View style={styles.tools}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${eventLabels[kind]} 시각 수정`}
        disabled={!latest(kind)}
        onPress={() => {
          const event = latest(kind);
          if (event) edit(event);
        }}
        style={styles.icon}
      >
        <Ionicons
          name="pencil-outline"
          size={18}
          color={latest(kind) ? colors.accent : colors.muted}
        />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${eventLabels[kind]} 리셋`}
        disabled={!count(kind)}
        onPress={() => reset(kind)}
        style={styles.icon}
      >
        <Ionicons
          name="refresh-outline"
          size={18}
          color={count(kind) ? colors.accent : colors.muted}
        />
      </Pressable>
    </View>
  );
  const eventColor = (kind: EventKind) => {
    const palette = isDark
      ? {
          cpr: "#67D2BC",
          cycle: "#A2CCC2",
          rhythm: "#90BDF0",
          shock: "#F0C36B",
          epi: "#FFAF7A",
          amio: "#C8AEF4",
          rosc: "#8CD7A5",
          rearrest: "#FF8A80",
        }
      : {
          cpr: "#087F6D",
          cycle: "#476A61",
          rhythm: "#32699A",
          shock: "#8C5B09",
          epi: "#9C4B16",
          amio: "#7651A2",
          rosc: "#237544",
          rearrest: "#B93732",
        };
    return palette[kind];
  };
  const metric = (kind: EventKind, label: string) => {
    const event = latest(kind);
    const medication = kind === "epi" || kind === "amio";
    const doses = events.filter((e) => e.kind === kind);
    const epi = epinephrineProgress(event ? now - event.at : 0);
    const epiColor =
      epi.window === "before" ? colors.accent : isDark ? "#F0C36B" : "#8C5B09";
    return (
      <View style={[styles.metric, { borderColor: colors.line }]} key={kind}>
        <View style={styles.metricHeading}>
          {text(label, styles.label)}
          {tools(kind)}
        </View>
        {kind === "epi" && (
          <Svg
            width={88}
            height={88}
            viewBox="0 0 88 88"
            accessibilityLabel="Epinephrine 마지막 투여 후 경과, 5분 참고 척도"
          >
            <Circle
              cx={44}
              cy={44}
              r={36}
              fill="none"
              stroke={colors.line}
              strokeWidth={6}
            />
            <Circle
              cx={44}
              cy={44}
              r={36}
              fill="none"
              stroke={isDark ? "#F0C36B" : "#8C5B09"}
              strokeOpacity={0.3}
              strokeWidth={6}
              strokeDasharray={`${2 * Math.PI * 36 * 0.4} ${2 * Math.PI * 36 * 0.6}`}
              rotation={126}
              origin="44,44"
            />
            <Circle
              cx={44}
              cy={44}
              r={36}
              fill="none"
              stroke={epiColor}
              strokeWidth={6}
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 36}
              strokeDashoffset={
                2 * Math.PI * 36 * (1 - (event ? epi.progress : 0))
              }
              rotation={-90}
              origin="44,44"
            />
          </Svg>
        )}
        {text(
          event
            ? elapsedText(
                (kind === "rosc"
                  ? (events.find(
                      (e) => e.kind === "rearrest" && e.at >= event.at,
                    )?.at ?? now)
                  : kind === "rearrest"
                    ? (events.find((e) => e.kind === "rosc" && e.at >= event.at)
                        ?.at ?? now)
                    : now) - event.at,
              )
            : "—",
          styles.number,
        )}
        <Text style={[styles.caption, { color: colors.muted }]}>
          {event
            ? medication
              ? `${count(kind)}회 투여 기록`
              : `${clockText(event.at)} · ${count(kind)}회`
            : "기록 없음"}
        </Text>
        {kind === "epi" && (
          <Text style={[styles.caption, { color: colors.muted }]}>
            3~5분 참고 구간 · 투여 기록 시 새로 시작
          </Text>
        )}
        {medication &&
          doses
            .slice(-3)
            .reverse()
            .map((dose, index) => (
              <Pressable
                key={dose.id}
                accessibilityRole="button"
                accessibilityLabel={`${eventLabels[kind]} ${doses.length - index}회 시각 수정`}
                onPress={() => edit(dose)}
                style={[styles.dose, { borderColor: colors.line }]}
              >
                <Text style={[styles.time, { color: colors.text }]}>
                  {doses.length - index}회 · {clockText(dose.at)}
                </Text>
                <Text style={[styles.time, { color: colors.muted }]}>
                  경과 {elapsedText(now - dose.at)}
                </Text>
              </Pressable>
            ))}
        {medication && doses.length > 3 && (
          <Text style={[styles.caption, { color: colors.muted }]}>
            최근 3회 표시 · 전체는 아래 사건 기록
          </Text>
        )}
      </View>
    );
  };
  return (
    <View style={{ display: visible ? "flex" : "none", gap: 16 }}>
      <Text style={[styles.label, { color: colors.muted }]}>
        {new Intl.DateTimeFormat("ko-KR", {
          year: "numeric",
          month: "long",
          day: "numeric",
          weekday: "long",
        }).format(now)}
      </Text>
      <View style={styles.row}>
        {text("SALS", styles.title)}
        {button(
          "전체 초기화",
          () =>
            Alert.alert(
              "SALS 전체 초기화",
              "모든 타이머와 사건 기록을 지울까요?",
              [
                { text: "취소", style: "cancel" },
                {
                  text: "지우기",
                  style: "destructive",
                  onPress: () => setEvents([]),
                },
              ],
            ),
          events.length === 0,
        )}
      </View>
      <Text style={[styles.label, { color: colors.accent }]}>
        {
          {
            idle: "시작 전",
            cpr: "CPR 진행 중",
            waiting: "구간 종료 · 실제 압박 재개 시 버튼을 누르세요",
            analysis: "리듬 분석 · 압박 재개 대기",
            rosc: "ROSC",
            rearrest: "재심정지 · CPR 재개 대기",
          }[snapshot.state]
        }
      </Text>
      <View
        style={[
          styles.panel,
          { backgroundColor: colors.bg, borderColor: colors.line },
        ]}
      >
        <View style={styles.row}>
          {text("압박 누적 · 기록 기준", styles.label)}
          {tools("cpr")}
        </View>
        {text(elapsedText(snapshot.total), styles.mainNumber)}
        <Text style={[styles.startTime, { color: colors.text }]}>
          시작 {latest("cpr") ? clockText(latest("cpr")!.at) : "—"}
        </Text>
        {button(
          snapshot.state === "idle" ? "압박 시작" : "압박 재개",
          () => add("cpr"),
          snapshot.state === "cpr",
          true,
        )}
        <View style={[styles.divider, { backgroundColor: colors.line }]} />
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <View style={styles.row}>
              {text(`${snapshot.cycleCount || 1}번째 압박 구간`, styles.label)}
              {tools("cycle")}
            </View>
            <Text style={[styles.number, { color: cycleColor }]}>
              {snapshot.cycleRemaining === null
                ? "—"
                : elapsedText(snapshot.cycleRemaining)}
            </Text>
            <Text style={[styles.caption, { color: colors.muted }]}>
              {snapshot.cycleCount}회 ·{" "}
              {snapshot.cycleRemaining === 0
                ? "구간 종료 · 재개 대기"
                : preparing
                  ? "교대 준비 · 압박 중단 신호가 아닙니다"
                  : "실제 압박 시작 시 새 2분 구간"}
            </Text>
          </View>
          <Animated.View style={{ opacity: pulse }}>
            <Svg width={80} height={80} viewBox="0 0 64 64">
              <Circle
                cx={32}
                cy={32}
                r={27}
                fill="none"
                stroke={colors.line}
                strokeWidth={6}
              />
              <Circle
                cx={32}
                cy={32}
                r={27}
                fill="none"
                stroke={cycleColor}
                strokeWidth={6}
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 27}
                strokeDashoffset={
                  2 *
                  Math.PI *
                  27 *
                  (1 - (snapshot.cycleRemaining ?? 0) / 120000)
                }
                rotation={-90}
                origin="32,32"
              />
            </Svg>
          </Animated.View>
        </View>
        {button(
          "교대 후 압박 시작 · 새 2분",
          () => add("cycle"),
          !["cpr", "waiting", "analysis", "rearrest"].includes(snapshot.state),
        )}
      </View>
      <View
        style={[
          styles.panel,
          { backgroundColor: colors.bg, borderColor: colors.line },
        ]}
      >
        {text("리듬 분석", styles.section)}
        <View style={styles.wrap}>
          {rhythms.map((rhythm) => (
            <View key={rhythm} style={styles.half}>
              {button(
                rhythm,
                () => add("rhythm", rhythm),
                snapshot.state === "rosc" || snapshot.state === "rearrest",
                latest("rhythm")?.detail === rhythm,
              )}
            </View>
          ))}
        </View>
        <View style={styles.row}>
          {text(
            `${count("rhythm")}회 · ${latest("rhythm") ? clockText(latest("rhythm")!.at) : "—"}`,
            styles.label,
          )}
          {tools("rhythm")}
        </View>
        <View style={styles.row}>
          {text(`제세동 ${count("shock")}회`, styles.section)}
          {tools("shock")}
        </View>
        {button("제세동 기록", () => add("shock"))}
        <Text style={[styles.caption, { color: colors.muted }]}>
          마지막 제세동 {latest("shock") ? clockText(latest("shock")!.at) : "—"}
        </Text>
      </View>
      <View
        style={[
          styles.panel,
          { backgroundColor: colors.bg, borderColor: colors.line },
        ]}
      >
        <View style={[styles.row, { alignItems: "flex-start" }]}>
          {metric("epi", "Epinephrine 이후 경과")}
          {metric("amio", "Amiodarone 이후 경과")}
        </View>
        <View style={styles.row}>
          {button("Epinephrine 투여 기록", () => add("epi"))}
          {button("Amiodarone 투여 기록", () => add("amio"))}
        </View>
        <View style={[styles.divider, { backgroundColor: colors.line }]} />
        <View style={styles.row}>
          {metric("rosc", "ROSC 이후 경과")}
          {metric("rearrest", "재심정지 이후 경과")}
        </View>
        <View style={styles.row}>
          {button(
            "ROSC 기록",
            () => add("rosc"),
            !["cpr", "waiting", "analysis", "rearrest"].includes(
              snapshot.state,
            ),
          )}
          {button(
            "재심정지 기록",
            () => add("rearrest"),
            snapshot.state !== "rosc",
          )}
        </View>
      </View>
      <View
        style={[
          styles.panel,
          { backgroundColor: colors.bg, borderColor: colors.line },
        ]}
      >
        <View style={styles.row}>
          {text("사건 기록", styles.section)}
          {button(
            "마지막 기록 취소",
            () =>
              Alert.alert(
                "마지막 기록 취소",
                "마지막 사건을 삭제하고 타이머를 다시 계산할까요?",
                [
                  { text: "취소", style: "cancel" },
                  {
                    text: "삭제",
                    style: "destructive",
                    onPress: () =>
                      setEvents((previous) => {
                        const index = previous.findLastIndex(
                          (event) => !event.hidden,
                        );
                        const last = previous[index];
                        const before = previous[index - 1];
                        const paired =
                          last?.kind === "cycle" &&
                          before?.kind === "cpr" &&
                          last.at === before.at;
                        return previous.filter(
                          (_, i) => i !== index && (!paired || i !== index - 1),
                        );
                      }),
                  },
                ],
              ),
            !events.some((event) => !event.hidden),
          )}
        </View>
        {!events.some((event) => !event.hidden) &&
          text("기록 없음", styles.label)}
        {events
          .filter((event) => !event.hidden)
          .reverse()
          .map((event) => (
            <Pressable
              key={event.id}
              accessibilityRole="button"
              accessibilityLabel={`${eventLabels[event.kind]} 시각 수정`}
              onPress={() => edit(event)}
              style={[styles.event, { borderColor: colors.line }]}
            >
              <View
                style={[
                  styles.eventDot,
                  { backgroundColor: eventColor(event.kind) },
                ]}
              />
              {text(clockText(event.at), styles.time)}
              <View style={{ flex: 1 }}>
                <Text style={[styles.body, { color: eventColor(event.kind) }]}>
                  {eventLabels[event.kind]}
                </Text>
                {event.detail && text(event.detail, styles.label)}
                {event.kind === "cycle" &&
                  text(
                    `${events.filter((e) => e.kind === "cycle").findIndex((e) => e.id === event.id) + 1}번째 구간 · ${elapsedText(eventDuration(events, event, now) ?? 0)}`,
                    styles.label,
                  )}
                {(event.kind === "rosc" || event.kind === "rearrest") &&
                  text(
                    `지속 ${elapsedText(eventDuration(events, event, now) ?? 0)}`,
                    styles.label,
                  )}
              </View>
              <Ionicons name="pencil-outline" size={16} color={colors.accent} />
            </Pressable>
          ))}
      </View>
      <Modal
        visible={!!editing}
        transparent
        animationType="fade"
        onRequestClose={() => setEditing(null)}
      >
        <View style={styles.backdrop}>
          <View
            style={[
              styles.panel,
              {
                width: "100%",
                maxWidth: 360,
                backgroundColor: colors.bg,
                borderColor: colors.line,
              },
            ]}
          >
            {text("시각 수정", styles.section)}
            <Text style={[styles.label, { color: colors.muted }]}>
              24시간 형식 · HH:mm:ss
            </Text>
            <TextInput
              accessibilityLabel="기록 시각"
              value={time}
              onChangeText={setTime}
              placeholder="14:05:00"
              placeholderTextColor={colors.muted}
              autoFocus
              autoCorrect={false}
              maxLength={8}
              style={[
                styles.input,
                {
                  backgroundColor: colors.input,
                  borderColor: colors.accent,
                  color: colors.text,
                },
              ]}
            />
            {!!error && (
              <Text
                accessibilityRole="alert"
                style={[
                  styles.label,
                  { color: isDark ? "#FF8A80" : "#C62828" },
                ]}
              >
                {error}
              </Text>
            )}
            <View style={styles.row}>
              {button("취소", () => setEditing(null))}
              {button(
                "적용",
                () => {
                  if (!editing) return;
                  const at = parseClock(time, editing.at);
                  const index = events.findIndex((e) => e.id === editing.id);
                  const firstCycle = events[index + 1];
                  const previousCpr = events[index - 1];
                  const linkedCycle =
                    editing.kind === "cpr" &&
                    firstCycle?.kind === "cycle" &&
                    firstCycle.at === editing.at
                      ? firstCycle.id
                      : editing.kind === "cycle" &&
                          previousCpr?.kind === "cpr" &&
                          previousCpr.at === editing.at
                        ? previousCpr.id
                        : null;
                  const previousIndex =
                    index - (linkedCycle === previousCpr?.id ? 2 : 1);
                  const nextIndex =
                    index + (linkedCycle === firstCycle?.id ? 2 : 1);
                  if (at === null) {
                    setError("00:00:00~23:59:59로 입력해 주세요.");
                    return;
                  }
                  if (
                    at > Date.now() ||
                    (previousIndex >= 0 && at < events[previousIndex]!.at) ||
                    (nextIndex < events.length && at > events[nextIndex]!.at)
                  ) {
                    setError("앞뒤 기록 순서와 현재 시각을 확인해 주세요.");
                    return;
                  }
                  setEvents((previous) =>
                    previous.map((e) =>
                      e.id === editing.id || e.id === linkedCycle
                        ? { ...e, at }
                        : e,
                    ),
                  );
                  setEditing(null);
                },
                false,
                true,
              )}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
const styles = StyleSheet.create({
  startTime: {
    fontFamily: "Pretendard-Medium",
    fontSize: 14,
    lineHeight: 20,
    fontVariant: ["tabular-nums"],
  },
  panel: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    justifyContent: "space-between",
  },
  metricHeading: { alignItems: "flex-start", gap: 4 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  half: { flexBasis: "47%", flexGrow: 1 },
  title: { fontFamily: "Pretendard-SemiBold", fontSize: 24 },
  section: { fontFamily: "Pretendard-Medium", fontSize: 18 },
  body: { fontFamily: "Pretendard-Regular", fontSize: 16 },
  action: {
    fontFamily: "Pretendard-Medium",
    fontSize: 14,
    textAlign: "center",
  },
  label: { fontFamily: "Pretendard-Regular", fontSize: 14 },
  caption: { fontFamily: "Pretendard-Regular", fontSize: 12 },
  mainNumber: {
    fontFamily: "Pretendard-Medium",
    fontSize: 36,
    fontVariant: ["tabular-nums"],
  },
  number: {
    fontFamily: "Pretendard-Medium",
    fontSize: 24,
    fontVariant: ["tabular-nums"],
  },
  time: {
    fontFamily: "Pretendard-Regular",
    fontSize: 14,
    fontVariant: ["tabular-nums"],
  },
  tools: { flexDirection: "row" },
  icon: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  button: {
    flexShrink: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  metric: { flex: 1, minWidth: 150, gap: 8 },
  dose: { minHeight: 48, paddingVertical: 8, borderTopWidth: 1, gap: 4 },
  divider: { height: 1, marginVertical: 4 },
  event: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    borderTopWidth: 1,
    paddingVertical: 12,
  },
  eventDot: { width: 8, height: 8, borderRadius: 4 },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 16,
    fontFamily: "Pretendard-Regular",
    fontVariant: ["tabular-nums"],
  },
});
