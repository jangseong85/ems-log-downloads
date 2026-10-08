import { StyleSheet } from "react-native";

/** Shared visual scale. Keep platform font scaling enabled on Text/TextInput. */
export const design = {
  radius: { control: 12, card: 16 },
  controlHeight: 48,
  spacing: { small: 8, medium: 16, large: 24 },
  type: { caption: 12, label: 14, body: 16, section: 18, title: 24 },
} as const;

const titleStyles = new Set(["title", "settingsTitle", "futureTitle"]);
const headingStyles = new Set([
  "sectionTitle",
  "handwritingTitle",
  "cameraTitle",
]);
const controlStyles = new Set([
  "singleInput",
  "onsetInput",
  "onsetDateBox",
  "onsetNowButton",
  "timeDisplay",
  "nowButton",
  "segmentButton",
  "ageDisplay",
  "handwritingHeaderButton",
  "handwritingSave",
  "handwritingTool",
]);
const bodyStyles = new Set([
  "memoInput",
  "singleInput",
  "onsetInput",
  "onsetDateField",
  "onsetWeekdayInline",
  "timeValue",
  "placeholder",
  "modeTitle",
]);

/** Normalize by role, not by screen; preserve circular camera controls and media. */
export function normalizeDesign<T extends StyleSheet.NamedStyles<T>>(
  source: T,
): T {
  return Object.fromEntries(
    Object.entries(source).map(([name, value]) => {
      const style = { ...(value as Record<string, unknown>) };
      if (typeof style.fontSize === "number") {
        const size = titleStyles.has(name)
          ? design.type.title
          : headingStyles.has(name)
            ? design.type.section
            : bodyStyles.has(name)
              ? design.type.body
              : name === "vitalInput"
                ? 24
                : style.fontSize <= 11
                  ? design.type.caption
                  : design.type.label;
        style.fontSize = size;
        style.lineHeight = Math.ceil(size * 1.4);
        style.fontWeight = titleStyles.has(name)
          ? "600"
          : bodyStyles.has(name) ||
              /Caption|Sub|Hint|unit|Unit|Placeholder/.test(name)
            ? "400"
            : "500";
      }
      if (controlStyles.has(name)) {
        delete style.height;
        style.minHeight = design.controlHeight;
        style.borderRadius = design.radius.control;
      }
      if (name === "card") {
        style.borderRadius = design.radius.card;
        style.shadowOpacity = 0;
        style.elevation = 0;
      }
      if (name === "page") {
        style.paddingHorizontal = design.spacing.medium;
        style.paddingTop = design.spacing.medium;
        style.gap = design.spacing.medium;
      }
      return [name, style];
    }),
  ) as unknown as T;
}
