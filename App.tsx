import AsyncStorage from "@react-native-async-storage/async-storage";
import { normalizeDesign } from "./src/design";
import SalsPage from "./src/SalsPage";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { CameraView, useCameraPermissions } from "expo-camera";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef, useState } from "react";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle, Path } from "react-native-svg";
import { captureRef } from "react-native-view-shot";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Modal,
  NativeModules,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import {
  calculateAge,
  extractIdentityFromOcr,
  findIdentityRegion,
} from "./src/idDate";

void SplashScreen.preventAutoHideAsync();

type VitalKey = "bp" | "pr" | "rr" | "spo2" | "bt" | "bst";
type IdDocument = {
  uri: string;
  name: string | null;
  birthDate: string | null;
  capturedAt: string;
};
type FormState = {
  patientId: string;
  chiefComplaint: string;
  onsetDate: string;
  onsetTime: string;
  measuredAt: string;
  bp: string;
  pr: string;
  rr: string;
  spo2: string;
  bt: string;
  bst: string;
  historyMemo: string;
  name: string;
  birthDate: string;
  gender: string;
  history: string[];
  idDocument: IdDocument | null;
  chiefComplaintDrawing: string | null;
  historyDrawing: string | null;
};
type LegacyFormState = Partial<FormState> & {
  complaintTags?: string[];
  vitalRecords?: unknown;
  dialysisStatus?: string;
  cancerHistory?: string;
  mentalHistory?: string;
  memo?: string;
};

const STORAGE_KEY = "ems-log.current-patient.v1";
const THEME_KEY = "ems-log.theme.v1";
const ERASER_SIZE_KEY = "ems-log.eraser-size.v1";
const EMPTY: FormState = {
  patientId: "",
  chiefComplaint: "",
  onsetDate: "",
  onsetTime: "",
  measuredAt: "",
  bp: "",
  pr: "",
  rr: "",
  spo2: "",
  bt: "",
  bst: "",
  historyMemo: "",
  name: "",
  birthDate: "",
  gender: "",
  history: [],
  idDocument: null,
  chiefComplaintDrawing: null,
  historyDrawing: null,
};
const HISTORY_PRIMARY_OPTIONS = ["고혈압", "당뇨", "고지혈증"];
const CEREBROVASCULAR_OPTIONS = ["뇌경색", "뇌출혈"];
const CARDIOVASCULAR_OPTIONS = ["협심증", "심근경색"];
const HISTORY_RESPIRATORY_OPTIONS = ["천식", "COPD"];
const DIALYSIS_OPTIONS = ["투석 월·수·금", "투석 화·목·토"];
const HISTORY_LAST_OPTIONS = ["암", "치매", "우울증"];

function historySummary(history: string[]): string {
  const dialysis = history.find((item) => DIALYSIS_OPTIONS.includes(item));
  const entries = history
    .filter((item) => !DIALYSIS_OPTIONS.includes(item))
    .map((item) =>
      item === "신부전" && dialysis ? `신부전(${dialysis})` : item,
    );
  return entries.length > 0 ? `과거력: ${entries.join(", ")}` : "";
}

function updateHistoryMemo(
  previousHistory: string[],
  nextHistory: string[],
  memo: string,
): string {
  const previousSummary = historySummary(previousHistory);
  const nextSummary = historySummary(nextHistory);

  if (previousSummary && memo.startsWith(previousSummary)) {
    const suffix = memo.slice(previousSummary.length);
    const userText = suffix.startsWith("\n")
      ? suffix
      : `\n${suffix.replace(/^ /, "")}`;
    return nextSummary ? `${nextSummary}${userText}` : userText.slice(1);
  }

  if (!nextSummary) return memo;
  return memo.length > 0 ? `${nextSummary}\n${memo}` : `${nextSummary}\n`;
}

const VITALS: {
  key: VitalKey;
  label: string;
  unit: string;
  decimal?: boolean;
}[] = [
  { key: "bp", label: "BP", unit: "mmHg" },
  { key: "pr", label: "PR", unit: "회/분" },
  { key: "rr", label: "RR", unit: "회/분" },
  { key: "spo2", label: "SpO₂", unit: "%" },
  { key: "bt", label: "BT", unit: "°C", decimal: true },
  { key: "bst", label: "BST", unit: "mg/dL" },
];

function koreanNow(): string {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}. ${get("month")}. ${get("day")}. ${get("hour")}:${get("minute")}`;
}

function displayBirthDate(value: string | null): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 4) return digits.length === 4 ? `${digits}. ` : digits;
  if (digits.length <= 6)
    return `${digits.slice(0, 4)}. ${digits.slice(4)}${digits.length === 6 ? ". " : ""}`;
  return `${digits.slice(0, 4)}. ${digits.slice(4, 6)}. ${digits.slice(6)}${digits.length === 8 ? "." : ""}`;
}

function updateBirthDate(previous: string, input: string): string {
  const digits = input.replace(/\D/g, "").slice(0, 8);
  if (input.length < displayBirthDate(previous).length && digits === previous)
    return previous.slice(0, -1);
  return digits;
}

function formatBloodPressure(previousValue: string, value: string): string {
  if (previousValue.endsWith("/") && value === previousValue.slice(0, -1))
    return value;
  const digits = value.replace(/\D/g, "").slice(0, 6);
  if (!digits) return "";
  const systolicLength = digits[0] === "1" || digits[0] === "2" ? 3 : 2;
  if (digits.length < systolicLength) return digits;
  return `${digits.slice(0, systolicLength)}/${digits.slice(systolicLength)}`;
}

function formatBodyTemperature(previousValue: string, value: string): string {
  if (previousValue.endsWith(".") && value === previousValue.slice(0, -1))
    return value;
  const digits = value.replace(/\D/g, "").slice(0, 3);
  if (digits.length < 2) return digits;
  return `${digits.slice(0, 2)}.${digits.slice(2)}`;
}

function displayOnsetTime(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  return digits.length <= 2
    ? digits
    : `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function displayOnsetDate(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 4) return digits.length === 4 ? `${digits}. ` : digits;
  if (digits.length <= 6)
    return `${digits.slice(0, 4)}. ${digits.slice(4)}${digits.length === 6 ? ". " : ""}`;
  return `${digits.slice(0, 4)}. ${digits.slice(4, 6)}. ${digits.slice(6)}${digits.length === 8 ? "." : ""}`;
}

function displayMeasuredAt(value: string): string {
  const match = value.match(
    /^(\d{4})\.\s*(\d{2})\.\s*(\d{2})\.?\s+(\d{2}:\d{2})$/,
  );
  return match ? `${match[1]}. ${match[2]}. ${match[3]}. ${match[4]}` : value;
}

function onsetWeekdayText(date: string): string | null {
  if (date.length !== 8) return null;
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));
  const parsed = new Date(year, month - 1, day, 12);
  if (
    year < 1900 ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  )
    return null;
  return (
    ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"][
      parsed.getDay()
    ] ?? null
  );
}

function onsetElapsedText(
  date: string,
  time: string,
  now: Date,
): string | null {
  if (date.length !== 8 || time.length !== 4) return null;
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(2));
  const onset = new Date(year, month - 1, day, hour, minute);
  if (
    year < 1900 ||
    onset.getFullYear() !== year ||
    onset.getMonth() !== month - 1 ||
    onset.getDate() !== day ||
    hour > 23 ||
    minute > 59
  )
    return "올바른 날짜와 시각을 입력해 주세요";
  const elapsedMinutes = Math.floor((now.getTime() - onset.getTime()) / 60000);
  if (elapsedMinutes < 0) return "현재보다 늦은 시각입니다";
  if (elapsedMinutes === 0) return null;
  if (elapsedMinutes < 60) return `${elapsedMinutes}분 전`;
  const days = Math.floor(elapsedMinutes / (24 * 60));
  const hours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;
  if (days > 0) {
    const remainingHours = hours % 24;
    return remainingHours > 0
      ? `${days}일 ${remainingHours}시간 전`
      : `${days}일 전`;
  }
  return minutes > 0 ? `${hours}시간 ${minutes}분 전` : `${hours}시간 전`;
}

function calculateMap(value: string): number | null {
  const match = value.match(/^(\d{2,3})\/(\d{2,3})$/);
  if (!match) return null;
  const systolic = Number(match[1]);
  const diastolic = Number(match[2]);
  return systolic > 0 && diastolic > 0
    ? Math.round((systolic + 2 * diastolic) / 3)
    : null;
}

function migrateStoredForm(stored: LegacyFormState): FormState {
  const storedWithoutVitalRecords = { ...stored };
  delete storedWithoutVitalRecords.vitalRecords;
  const patientId =
    stored.patientId ||
    [
      stored.name && `성함: ${stored.name}`,
      stored.birthDate && `생년월일: ${stored.birthDate}`,
      stored.gender && `성별: ${stored.gender}`,
    ]
      .filter(Boolean)
      .join(" · ");
  const chiefComplaint = [
    (stored.complaintTags ?? []).join(", "),
    stored.chiefComplaint,
  ]
    .filter(Boolean)
    .join("\n");
  const historyLines = [
    (stored.history ?? []).length > 0 &&
      `과거력: ${(stored.history ?? []).join(", ")}`,
    stored.dialysisStatus &&
      stored.dialysisStatus !== "해당 없음" &&
      `투석: ${stored.dialysisStatus}`,
    stored.cancerHistory && `암: ${stored.cancerHistory}`,
    stored.mentalHistory && `정신질환: ${stored.mentalHistory}`,
    stored.memo,
  ].filter(Boolean);
  return {
    ...EMPTY,
    ...storedWithoutVitalRecords,
    patientId,
    chiefComplaint,
    historyMemo: stored.historyMemo || historyLines.join("\n"),
    history: stored.history ?? [],
    idDocument: stored.idDocument ?? null,
  };
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    "Pretendard-Regular": require("pretendard/dist/public/static/Pretendard-Regular.otf"),
    "Pretendard-Medium": require("pretendard/dist/public/static/Pretendard-Medium.otf"),
    "Pretendard-SemiBold": require("pretendard/dist/public/static/Pretendard-SemiBold.otf"),
    "Pretendard-Bold": require("pretendard/dist/public/static/Pretendard-Bold.otf"),
  });
  const systemColorScheme = useColorScheme();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [themeMode, setThemeMode] = useState<"system" | "light" | "dark">(
    "system",
  );
  const skipInitialSave = useRef(true);
  const [activeTab, setActiveTab] = useState<
    "memo" | "sals" | "mci" | "settings"
  >("memo");
  const [scannerBusy, setScannerBusy] = useState(false);
  const [cameraVisible, setCameraVisible] = useState(false);
  const [drawingTarget, setDrawingTarget] = useState<
    "chiefComplaintDrawing" | "historyDrawing" | null
  >(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [showIntro, setShowIntro] = useState(true);
  const introDim = useRef(new Animated.Value(0.56)).current;
  const introOpacity = useRef(new Animated.Value(1)).current;
  const introScale = useRef(new Animated.Value(1.025)).current;
  const scrollRef = useRef<ScrollView>(null);
  const sectionY = useRef({
    patientId: 0,
    chiefComplaint: 0,
    vitals: 0,
    historyMemo: 0,
  });
  const isDark =
    themeMode === "system"
      ? systemColorScheme === "dark"
      : themeMode === "dark";
  const map = calculateMap(form.bp);
  const isMapLow = map !== null && map < 65;

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(STORAGE_KEY),
      AsyncStorage.getItem(THEME_KEY),
    ])
      .then(async ([saved, savedTheme]) => {
        if (
          savedTheme === "light" ||
          savedTheme === "dark" ||
          savedTheme === "system"
        )
          setThemeMode(savedTheme);
        if (saved) {
          const storedForm = JSON.parse(saved) as LegacyFormState;
          setForm(migrateStoredForm(storedForm));
        }
        await AsyncStorage.multiRemove([
          "ems-log.input-mode.v1",
          "ems-log.auto-delete-hours.v1",
          "ems-log.updated-at.v1",
        ]);
      })
      .catch(() =>
        Alert.alert("안내", "이전에 작성한 내용을 불러오지 못했습니다."),
      )
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded || (!fontsLoaded && !fontError)) return;
    if (skipInitialSave.current) {
      skipInitialSave.current = false;
      return;
    }
    const timer = setTimeout(() => {
      void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(form));
    }, 250);
    return () => clearTimeout(timer);
  }, [form, loaded]);

  useEffect(() => {
    if (!loaded) return;
    void SplashScreen.hideAsync();
    const animation = Animated.sequence([
      Animated.parallel([
        Animated.timing(introDim, {
          toValue: 0,
          duration: 1050,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(introScale, {
          toValue: 1,
          duration: 1250,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(450),
      Animated.timing(introOpacity, {
        toValue: 0,
        duration: 360,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    animation.start(({ finished }) => finished && setShowIntro(false));
    return () => animation.stop();
  }, [fontError, fontsLoaded, introDim, introOpacity, introScale, loaded]);

  const update = (key: keyof FormState, value: string) =>
    setForm((previous) => ({ ...previous, [key]: value }));
  const reveal = (key: keyof typeof sectionY.current) =>
    setTimeout(
      () =>
        scrollRef.current?.scrollTo({
          y: Math.max(0, sectionY.current[key] - 55),
          animated: true,
        }),
      120,
    );
  const toggleTheme = () => {
    const nextMode = isDark ? "light" : "dark";
    setThemeMode(nextMode);
    void AsyncStorage.setItem(THEME_KEY, nextMode);
  };
  const toggleHistoryItem = (item: string) =>
    setForm((previous) => {
      const selected = previous.history.includes(item);
      const history = selected
        ? previous.history.filter((value) => value !== item)
        : [...previous.history, item];
      return {
        ...previous,
        history,
        historyMemo: updateHistoryMemo(
          previous.history,
          history,
          previous.historyMemo,
        ),
      };
    });
  const deleteDocument = async () => {
    const uri = form.idDocument?.uri;
    setForm((previous) => ({ ...previous, idDocument: null }));
    if (uri)
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(
        () => undefined,
      );
  };
  const deleteLocalFile = (uri: string | null) =>
    uri
      ? FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined)
      : Promise.resolve();
  const saveDrawing = async (temporaryUri: string) => {
    if (!drawingTarget) return;
    const directory = `${FileSystem.documentDirectory}handwritten-notes/`;
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    const savedUri = `${directory}${drawingTarget}-${Date.now()}.png`;
    await FileSystem.copyAsync({ from: temporaryUri, to: savedUri });
    const previousUri = form[drawingTarget];
    setForm((previous) => ({ ...previous, [drawingTarget]: savedUri }));
    setDrawingTarget(null);
    void deleteLocalFile(previousUri);
  };
  const deleteDrawing = (key: "chiefComplaintDrawing" | "historyDrawing") => {
    const uri = form[key];
    setForm((previous) => ({ ...previous, [key]: null }));
    void deleteLocalFile(uri);
  };
  const reset = () =>
    Alert.alert(
      "입력 내용 초기화",
      "현재 입력 내용과 촬영·필기 자료를 모두 지울까요?",
      [
        { text: "취소", style: "cancel" },
        {
          text: "지우기",
          style: "destructive",
          onPress: () => {
            void deleteDocument();
            void deleteLocalFile(form.chiefComplaintDrawing);
            void deleteLocalFile(form.historyDrawing);
            setForm(EMPTY);
          },
        },
      ],
    );
  const openIdentityCamera = async () => {
    if (scannerBusy) return;
    const permission = cameraPermission?.granted
      ? cameraPermission
      : await requestCameraPermission();
    if (!permission.granted) {
      Alert.alert(
        "카메라 권한 필요",
        "신분증을 촬영하려면 카메라 접근을 허용해 주세요.",
      );
      return;
    }
    setCameraVisible(true);
  };
  const captureIdentity = async () => {
    if (scannerBusy) return;
    setScannerBusy(true);
    try {
      const photo = await cameraRef.current?.takePictureAsync({
        quality: 1,
        skipProcessing: false,
        shutterSound: false,
      });
      if (!photo?.uri) return;
      NativeModules.SoftShutter?.play();
      setCameraVisible(false);
      // CameraView는 세로 화면을 채우기 위해 센서 사진의 좌우를 잘라 보여 줍니다.
      // 화면의 카드 가이드와 같은 중앙 영역만 먼저 잘라 OCR에 전달하면 글자가 훨씬 크게 들어옵니다.
      const capturedSource = await ImageManipulator.ImageManipulator.manipulate(
        photo.uri,
      ).renderAsync();
      const portrait = capturedSource.height >= capturedSource.width;
      const cropWidth = Math.floor(
        capturedSource.width * (portrait ? 0.62 : 0.9),
      );
      const cropHeight = Math.min(
        capturedSource.height,
        Math.floor(cropWidth / 1.58),
      );
      const preparedContext = ImageManipulator.ImageManipulator.manipulate(
        photo.uri,
      );
      preparedContext.crop({
        originX: Math.max(
          0,
          Math.floor((capturedSource.width - cropWidth) / 2),
        ),
        originY: Math.max(
          0,
          Math.floor((capturedSource.height - cropHeight) / 2),
        ),
        width: cropWidth,
        height: cropHeight,
      });
      if (cropWidth < 1800)
        preparedContext.resize({ width: 1800, height: null });
      const preparedRef = await preparedContext.renderAsync();
      const preparedImage = await preparedRef.saveAsync({
        compress: 1,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      const imageUri = preparedImage.uri;
      const documentsDirectory = `${FileSystem.documentDirectory}identity-documents/`;
      await FileSystem.makeDirectoryAsync(documentsDirectory, {
        intermediates: true,
      });
      const savedUri = `${documentsDirectory}id-${Date.now()}.jpg`;
      await FileSystem.copyAsync({ from: imageUri, to: savedUri });
      void FileSystem.deleteAsync(imageUri, { idempotent: true }).catch(
        () => undefined,
      );
      const { recognizeText } =
        await import("@infinitered/react-native-mlkit-text-recognition");
      const result = await recognizeText(savedUri);
      let identity = extractIdentityFromOcr(result);
      const region = findIdentityRegion(result);
      if (region) {
        const source =
          await ImageManipulator.ImageManipulator.manipulate(
            savedUri,
          ).renderAsync();
        const originX = Math.max(0, Math.floor(region.left));
        const originY = Math.max(0, Math.floor(region.top));
        const width = Math.max(
          1,
          Math.min(
            source.width - originX,
            Math.ceil(region.right - region.left),
          ),
        );
        const height = Math.max(
          1,
          Math.min(
            source.height - originY,
            Math.ceil(region.bottom - region.top),
          ),
        );
        const context = ImageManipulator.ImageManipulator.manipulate(savedUri);
        context.crop({ originX, originY, width, height });
        if (width < 1500) context.resize({ width: 1500, height: null });
        const croppedRef = await context.renderAsync();
        const croppedImage = await croppedRef.saveAsync({
          compress: 1,
          format: ImageManipulator.SaveFormat.JPEG,
        });
        try {
          const focusedResult = await recognizeText(croppedImage.uri);
          const focusedIdentity = extractIdentityFromOcr(focusedResult);
          identity = {
            name: focusedIdentity.name ?? identity.name,
            birthDate: focusedIdentity.birthDate ?? identity.birthDate,
            gender: focusedIdentity.gender ?? identity.gender,
          };
        } finally {
          void FileSystem.deleteAsync(croppedImage.uri, {
            idempotent: true,
          }).catch(() => undefined);
        }
      }
      const previousUri = form.idDocument?.uri;
      setForm((previous) => ({
        ...previous,
        idDocument: {
          uri: savedUri,
          name: identity.name,
          birthDate: identity.birthDate,
          capturedAt: koreanNow(),
        },
        ...(identity.name ? { name: identity.name } : {}),
        ...(identity.birthDate ? { birthDate: identity.birthDate } : {}),
        ...(identity.gender ? { gender: identity.gender } : {}),
      }));
      if (previousUri && previousUri !== savedUri)
        void FileSystem.deleteAsync(previousUri, { idempotent: true }).catch(
          () => undefined,
        );
      if (!identity.name && !identity.birthDate) {
        Alert.alert(
          "자료는 저장했습니다",
          "성명과 생년월일은 인식하지 못했습니다. 빛 반사를 피해서 다시 촬영해 주세요.",
        );
        return;
      }
      Alert.alert(
        "인식 완료",
        `성명: ${identity.name ?? "인식 안 됨"}\n생년월일: ${displayBirthDate(identity.birthDate) || "인식 안 됨"}`,
        [{ text: "확인" }],
      );
    } catch (error) {
      Alert.alert(
        "신분증 인식 오류",
        error instanceof Error
          ? error.message
          : "카메라 또는 문자 인식을 실행하지 못했습니다.",
      );
    } finally {
      setScannerBusy(false);
    }
  };

  if (!loaded || (!fontsLoaded && !fontError))
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#087F6D" />
      </View>
    );
  return (
    <SafeAreaProvider>
      <View style={[styles.flex, isDark && darkStyles.appBackground]}>
        <SafeAreaView
          style={[styles.safe, isDark && darkStyles.safe]}
          edges={["top", "bottom"]}
        >
          <StatusBar style={isDark ? "light" : "dark"} />
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 12}
          >
            <ScrollView
              ref={scrollRef}
              style={styles.flex}
              contentContainerStyle={styles.page}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
            >
              <View style={styles.header}>
                <Text style={[styles.title, isDark && darkStyles.primaryText]}>
                  EMS Log
                </Text>
                <View style={styles.headerActions}>
                  <Pressable
                    onPress={toggleTheme}
                    style={[styles.iconButton, isDark && darkStyles.softButton]}
                  >
                    <Ionicons
                      name={isDark ? "sunny-outline" : "moon-outline"}
                      size={18}
                      color={isDark ? "#D8E7E3" : "#315C54"}
                    />
                  </Pressable>
                  {activeTab === "memo" && (
                    <Pressable
                      onPress={reset}
                      style={[
                        styles.resetButton,
                        isDark && darkStyles.softButton,
                      ]}
                    >
                      <Text
                        style={[
                          styles.resetText,
                          isDark && darkStyles.softButtonText,
                        ]}
                      >
                        초기화
                      </Text>
                    </Pressable>
                  )}
                </View>
              </View>
              {activeTab === "memo" ? (
                <>
                  <AdvancedPatient
                    form={form}
                    isDark={isDark}
                    update={update}
                    onScan={() => void openIdentityCamera()}
                    onDeleteDocument={() => void deleteDocument()}
                    scannerBusy={scannerBusy}
                    onLayout={(y) => {
                      sectionY.current.patientId = y;
                    }}
                  />
                  <MemoCard
                    step="2"
                    title="Chief Complaint"
                    value={form.chiefComplaint}
                    onsetDate={form.onsetDate}
                    onsetTime={form.onsetTime}
                    drawingUri={form.chiefComplaintDrawing}
                    placeholder="주증상과 증상 경과를 기록하세요"
                    isDark={isDark}
                    onChangeOnsetDate={(value) =>
                      update("onsetDate", value.replace(/\D/g, "").slice(0, 8))
                    }
                    onChangeOnsetTime={(value) =>
                      update("onsetTime", value.replace(/\D/g, "").slice(0, 4))
                    }
                    onDraw={() => setDrawingTarget("chiefComplaintDrawing")}
                    onDeleteDrawing={() =>
                      deleteDrawing("chiefComplaintDrawing")
                    }
                    onChange={(value) => update("chiefComplaint", value)}
                    onFocus={() => reveal("chiefComplaint")}
                    onLayout={(y) => {
                      sectionY.current.chiefComplaint = y;
                    }}
                  />
                  <View
                    style={[styles.card, isDark && darkStyles.card]}
                    onLayout={(event) => {
                      sectionY.current.vitals = event.nativeEvent.layout.y;
                    }}
                  >
                    <SectionHeading
                      step="3"
                      title="Vital Signs"
                      isDark={isDark}
                    />
                    <Text
                      style={[styles.label, isDark && darkStyles.secondaryText]}
                    >
                      측정 시각
                    </Text>
                    <View style={styles.timeRow}>
                      <View
                        style={[styles.timeDisplay, isDark && darkStyles.input]}
                      >
                        <Text
                          style={[
                            form.measuredAt
                              ? styles.timeValue
                              : styles.placeholder,
                            isDark &&
                              (form.measuredAt
                                ? darkStyles.primaryText
                                : darkStyles.placeholderText),
                          ]}
                        >
                          {form.measuredAt
                            ? displayMeasuredAt(form.measuredAt)
                            : "YYYY. MM. DD. HH:MM"}
                        </Text>
                      </View>
                      <Pressable
                        style={styles.nowButton}
                        onPress={() => update("measuredAt", koreanNow())}
                      >
                        <Text style={styles.nowText}>현재</Text>
                      </Pressable>
                    </View>
                    <View
                      style={[styles.divider, isDark && darkStyles.divider]}
                    />
                    <View style={styles.grid}>
                      {VITALS.map((vital, index) => (
                        <View
                          key={vital.key}
                          style={[styles.vitalBox, isDark && darkStyles.input]}
                        >
                          <View style={styles.vitalTop}>
                            <Text
                              style={[
                                styles.vitalLabel,
                                isDark && darkStyles.accentText,
                              ]}
                            >
                              {vital.label}
                            </Text>
                            <Text
                              style={[
                                styles.unit,
                                isDark && darkStyles.tertiaryText,
                              ]}
                            >
                              {vital.unit}
                            </Text>
                          </View>
                          <View style={styles.vitalValueRow}>
                            <TextInput
                              value={form[vital.key]}
                              onChangeText={(value) =>
                                vital.key === "bp"
                                  ? setForm((previous) => ({
                                      ...previous,
                                      bp: formatBloodPressure(
                                        previous.bp,
                                        value,
                                      ),
                                    }))
                                  : vital.key === "bt"
                                    ? setForm((previous) => ({
                                        ...previous,
                                        bt: formatBodyTemperature(
                                          previous.bt,
                                          value,
                                        ),
                                      }))
                                    : update(vital.key, value)
                              }
                              onFocus={() =>
                                setTimeout(
                                  () =>
                                    scrollRef.current?.scrollTo({
                                      y: Math.max(
                                        0,
                                        sectionY.current.vitals +
                                          Math.floor(index / 2) * 108 -
                                          90,
                                      ),
                                      animated: true,
                                    }),
                                  120,
                                )
                              }
                              keyboardType={
                                vital.decimal ? "decimal-pad" : "number-pad"
                              }
                              maxLength={
                                vital.key === "bp"
                                  ? 7
                                  : vital.key === "bt"
                                    ? 4
                                    : undefined
                              }
                              style={[
                                styles.vitalInput,
                                isDark && darkStyles.primaryText,
                              ]}
                            />
                          </View>
                          {vital.key === "bp" && (
                            <View
                              style={[
                                styles.mapBadge,
                                map === null && styles.mapBadgeEmpty,
                                isDark && darkStyles.mapBadge,
                                isMapLow && styles.mapBadgeDanger,
                                isDark && isMapLow && darkStyles.mapBadgeDanger,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.mapLabel,
                                  isDark && darkStyles.accentText,
                                  isMapLow && styles.dangerText,
                                  isDark && isMapLow && darkStyles.dangerText,
                                ]}
                              >
                                MAP
                              </Text>
                              <Text
                                style={[
                                  styles.mapValue,
                                  isDark && darkStyles.primaryText,
                                  map === null && styles.mapEmpty,
                                  isDark &&
                                    map === null &&
                                    darkStyles.emptyText,
                                  isMapLow && styles.dangerText,
                                  isDark && isMapLow && darkStyles.dangerText,
                                ]}
                              >
                                {map ?? "—"}
                              </Text>
                              <Text
                                style={[
                                  styles.mapUnit,
                                  isDark && darkStyles.tertiaryText,
                                  isMapLow && styles.dangerSubText,
                                  isDark &&
                                    isMapLow &&
                                    darkStyles.dangerSubText,
                                ]}
                              >
                                mmHg
                              </Text>
                            </View>
                          )}
                        </View>
                      ))}
                    </View>
                  </View>
                  <MemoCard
                    step="4"
                    title="History"
                    value={form.historyMemo}
                    drawingUri={form.historyDrawing}
                    placeholder="과거력, 복용약, 수술력, 알레르기 등을 기록하세요"
                    isDark={isDark}
                    historyOptions
                    selectedOptions={form.history}
                    onToggleOption={toggleHistoryItem}
                    tall
                    onDraw={() => setDrawingTarget("historyDrawing")}
                    onDeleteDrawing={() => deleteDrawing("historyDrawing")}
                    onChange={(value) => update("historyMemo", value)}
                    onFocus={() => reveal("historyMemo")}
                    onLayout={(y) => {
                      sectionY.current.historyMemo = y;
                    }}
                  />
                </>
              ) : activeTab === "settings" ? (
                <SettingsPage isDark={isDark} onToggleTheme={toggleTheme} />
              ) : activeTab === "mci" ? (
                <FuturePage isDark={isDark} />
              ) : null}
              <SalsPage isDark={isDark} visible={activeTab === "sals"} />
            </ScrollView>
          </KeyboardAvoidingView>
          <BottomNavigation
            activeTab={activeTab}
            isDark={isDark}
            onSelect={setActiveTab}
          />
          <HandwritingModal
            visible={drawingTarget !== null}
            isDark={isDark}
            title={
              drawingTarget === "historyDrawing" ? "History" : "Chief Complaint"
            }
            initialUri={drawingTarget ? form[drawingTarget] : null}
            onClose={() => setDrawingTarget(null)}
            onSave={(uri) => void saveDrawing(uri)}
          />
        </SafeAreaView>
        <Modal
          visible={cameraVisible}
          animationType="slide"
          statusBarTranslucent
          onRequestClose={() => !scannerBusy && setCameraVisible(false)}
        >
          <View style={styles.cameraPage}>
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing="back"
              autofocus="on"
            />
            <View style={styles.cameraOverlay}>
              <View style={styles.cameraHeader}>
                <Pressable
                  disabled={scannerBusy}
                  onPress={() => setCameraVisible(false)}
                  style={styles.cameraClose}
                >
                  <Ionicons name="close" size={27} color="#FFFFFF" />
                </Pressable>
                <Text style={styles.cameraTitle}>신분증 촬영</Text>
                <View style={styles.cameraHeaderSpace} />
              </View>
              <View style={styles.guideWrap}>
                <View style={styles.guide} />
                <Text style={styles.guideText}>
                  신분증이 테두리를 가득 채우게 가까이 촬영하세요
                </Text>
                <Text style={styles.guideSub}>
                  가이드 안쪽만 저장·인식되며 편집 화면은 표시하지 않습니다
                </Text>
              </View>
              <Pressable
                disabled={scannerBusy}
                onPress={() => void captureIdentity()}
                style={[
                  styles.shutterOuter,
                  scannerBusy && styles.disabledButton,
                ]}
              >
                <View style={styles.shutterInner}>
                  {scannerBusy && <ActivityIndicator color="#087F6D" />}
                </View>
              </Pressable>
            </View>
          </View>
        </Modal>
        {showIntro && (
          <Animated.View
            pointerEvents="none"
            style={[styles.intro, { opacity: introOpacity }]}
          >
            <Animated.View
              style={[
                styles.introImageWrap,
                { transform: [{ scale: introScale }] },
              ]}
            >
              <Image
                source={require("./assets/splash-screen.png")}
                resizeMode="contain"
                style={styles.introImage}
              />
            </Animated.View>
            <Animated.View style={[styles.introDim, { opacity: introDim }]} />
          </Animated.View>
        )}
      </View>
    </SafeAreaProvider>
  );
}

type AdvancedProps = {
  form: FormState;
  isDark: boolean;
  update: (key: keyof FormState, value: string) => void;
  onLayout: (y: number) => void;
};
function AdvancedPatient({
  form,
  isDark,
  update,
  onScan,
  onDeleteDocument,
  scannerBusy,
  onLayout,
}: AdvancedProps & {
  onScan: () => void;
  onDeleteDocument: () => void;
  scannerBusy: boolean;
}) {
  const age = calculateAge(form.birthDate);
  return (
    <View
      style={[styles.card, isDark && darkStyles.card]}
      onLayout={(event) => onLayout(event.nativeEvent.layout.y)}
    >
      <SectionHeading step="1" title="Patient ID" isDark={isDark} />
      <Text style={[styles.label, isDark && darkStyles.secondaryText]}>
        이름
      </Text>
      <TextInput
        value={form.name}
        onChangeText={(value) => update("name", value)}
        placeholder="환자 이름"
        placeholderTextColor={isDark ? "#8DA29C" : "#9DA9A6"}
        style={[styles.singleInput, isDark && darkStyles.input]}
      />
      <Text style={[styles.label, isDark && darkStyles.secondaryText]}>
        생년월일
      </Text>
      <View style={styles.birthInputRow}>
        <TextInput
          value={displayBirthDate(form.birthDate)}
          onChangeText={(value) =>
            update("birthDate", updateBirthDate(form.birthDate, value))
          }
          keyboardType="number-pad"
          maxLength={13}
          placeholder="YYYY. MM. DD."
          placeholderTextColor={isDark ? "#8DA29C" : "#9DA9A6"}
          style={[
            styles.singleInput,
            styles.birthInput,
            isDark && darkStyles.input,
          ]}
        />
        <View style={[styles.ageDisplay, isDark && darkStyles.softButton]}>
          <Text
            style={[
              age === null ? styles.agePlaceholder : styles.ageText,
              isDark &&
                (age === null
                  ? darkStyles.tertiaryText
                  : darkStyles.accentText),
            ]}
          >
            {age === null ? "만 나이" : `만 ${age}세`}
          </Text>
        </View>
      </View>
      <Text style={[styles.label, isDark && darkStyles.secondaryText]}>
        성별
      </Text>
      <View style={styles.segmentRow}>
        {["남성", "여성"].map((item) => (
          <Pressable
            key={item}
            onPress={() => update("gender", form.gender === item ? "" : item)}
            style={[
              styles.segmentButton,
              isDark && darkStyles.input,
              form.gender === item && styles.selectedButton,
              isDark && form.gender === item && darkStyles.selectedButton,
            ]}
          >
            <Text
              style={[
                styles.chipText,
                isDark && darkStyles.secondaryText,
                form.gender === item && styles.selectedText,
              ]}
            >
              {item}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.documentRow}>
        <Pressable
          disabled={scannerBusy}
          onPress={onScan}
          style={[
            styles.scanButton,
            styles.scanButtonCompact,
            isDark && darkStyles.softButton,
            scannerBusy && styles.disabledButton,
          ]}
        >
          {scannerBusy ? (
            <ActivityIndicator
              size="small"
              color={isDark ? "#67D2BC" : "#087F6D"}
            />
          ) : (
            <Ionicons
              name="camera"
              size={20}
              color={isDark ? "#67D2BC" : "#087F6D"}
            />
          )}
          <View style={styles.modeText}>
            <Text style={[styles.scanTitle, isDark && darkStyles.primaryText]}>
              {scannerBusy ? "인식 중" : "신분증 촬영"}
            </Text>
            <Text
              style={[styles.scanCaption, isDark && darkStyles.secondaryText]}
            >
              성명·생년월일 인식
            </Text>
          </View>
        </Pressable>
        {form.idDocument && (
          <SwipeDocument
            document={form.idDocument}
            isDark={isDark}
            onDelete={onDeleteDocument}
          />
        )}
      </View>
      {form.idDocument && (
        <Text style={[styles.swipeHint, isDark && darkStyles.secondaryText]}>
          촬영 자료를 왼쪽으로 밀어 삭제
        </Text>
      )}
    </View>
  );
}

function SwipeDocument({
  document,
  isDark,
  onDelete,
}: {
  document: IdDocument;
  isDark: boolean;
  onDelete: () => void;
}) {
  const [previewVisible, setPreviewVisible] = useState(false);
  return (
    <>
      <SwipeToDelete
        accessibilityLabel="촬영 자료 삭제"
        onDelete={onDelete}
        containerStyle={[styles.documentSwipe, styles.documentEqualWidth]}
        contentStyle={[
          styles.documentCard,
          styles.documentCardEqualWidth,
          isDark && darkStyles.input,
        ]}
      >
        <Pressable
          accessibilityLabel="촬영한 신분증 보기"
          onPress={() => setPreviewVisible(true)}
          style={styles.documentPreviewButton}
        >
          <Ionicons
            name="image-outline"
            size={20}
            color={isDark ? "#FFFFFF" : "#087F6D"}
          />
          <Text
            style={[styles.documentViewText, isDark && darkStyles.primaryText]}
          >
            보기
          </Text>
        </Pressable>
      </SwipeToDelete>
      <Modal
        visible={previewVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setPreviewVisible(false)}
      >
        <Pressable
          style={styles.previewBackdrop}
          onPress={() => setPreviewVisible(false)}
        >
          <Image
            source={{ uri: document.uri }}
            resizeMode="contain"
            style={styles.previewImage}
          />
          <View style={styles.previewClose}>
            <Ionicons name="close" size={27} color="#FFFFFF" />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

function SwipeToDelete({
  children,
  onDelete,
  accessibilityLabel,
  containerStyle,
  contentStyle,
}: {
  children: React.ReactNode;
  onDelete: () => void;
  accessibilityLabel: string;
  containerStyle?: object;
  contentStyle?: object;
}) {
  const revealWidth = 92;
  const translateX = useRef(new Animated.Value(0)).current;
  const dragStart = useRef(0);
  const opened = useRef(false);
  const deleteOpacity = translateX.interpolate({
    inputRange: [-revealWidth, -20, 0],
    outputRange: [1, 0.35, 0],
    extrapolate: "clamp",
  });
  const deleteScale = translateX.interpolate({
    inputRange: [-revealWidth, -35, 0],
    outputRange: [1, 0.78, 0.65],
    extrapolate: "clamp",
  });
  const snap = (toValue: number) => {
    opened.current = toValue < 0;
    Animated.spring(translateX, {
      toValue,
      velocity: 0.35,
      tension: 115,
      friction: 16,
      useNativeDriver: true,
    }).start();
  };
  const confirmDelete = () => {
    Alert.alert(
      "삭제하시겠습니까?",
      "삭제한 자료는 복구할 수 없습니다.",
      [
        {
          text: "취소",
          style: "cancel",
          onPress: () => snap(0),
        },
        {
          text: "삭제",
          style: "destructive",
          onPress: () => {
            Animated.timing(translateX, {
              toValue: -420,
              duration: 220,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }).start(({ finished }) => finished && onDelete());
          },
        },
      ],
      { cancelable: false },
    );
  };
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) > 5 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderGrant: () => {
        translateX.stopAnimation((value) => {
          dragStart.current = value;
        });
      },
      onPanResponderMove: (_, gesture) => {
        const next = dragStart.current + gesture.dx;
        translateX.setValue(Math.max(-revealWidth, Math.min(0, next)));
      },
      onPanResponderRelease: (_, gesture) => {
        const finalPosition = dragStart.current + gesture.dx;
        if (gesture.dx < -145 && !opened.current) {
          snap(-revealWidth);
          setTimeout(confirmDelete, 180);
          return;
        }
        snap(finalPosition < -42 || gesture.vx < -0.55 ? -revealWidth : 0);
      },
      onPanResponderTerminate: () => snap(opened.current ? -revealWidth : 0),
    }),
  ).current;
  return (
    <View style={[styles.swipeContainer, containerStyle]}>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        onPress={confirmDelete}
        style={styles.swipeDeleteAction}
      >
        <Animated.View
          style={{
            opacity: deleteOpacity,
            transform: [{ scale: deleteScale }],
          }}
        >
          <Ionicons name="trash-outline" size={22} color="#FFFFFF" />
          <Text style={styles.swipeDeleteText}>삭제</Text>
        </Animated.View>
      </Pressable>
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.swipeContent,
          contentStyle,
          { transform: [{ translateX }] },
        ]}
      >
        {children}
      </Animated.View>
    </View>
  );
}
function HistoryOptionPicker({
  history,
  isDark,
  toggle,
}: {
  history: string[];
  isDark: boolean;
  toggle: (item: string) => void;
}) {
  const [cerebrovascularOpen, setCerebrovascularOpen] = useState(() =>
    CEREBROVASCULAR_OPTIONS.some((item) => history.includes(item)),
  );
  const [cardiovascularOpen, setCardiovascularOpen] = useState(() =>
    CARDIOVASCULAR_OPTIONS.some((item) => history.includes(item)),
  );
  const [respiratoryOpen, setRespiratoryOpen] = useState(() =>
    HISTORY_RESPIRATORY_OPTIONS.some((item) => history.includes(item)),
  );
  const renalSelected = history.includes("신부전");

  const closeGroup = (
    options: string[],
    close: React.Dispatch<React.SetStateAction<boolean>>,
  ) => {
    options.forEach((item) => {
      if (history.includes(item)) toggle(item);
    });
    close(false);
  };

  const historyChip = (
    item: string,
    options?: {
      label?: string;
      selected?: boolean;
      expanded?: boolean;
      secondary?: boolean;
      onPress?: () => void;
    },
  ) => {
    const selected = options?.selected ?? history.includes(item);
    return (
      <Pressable
        key={item}
        accessibilityRole="button"
        accessibilityState={{ selected, expanded: options?.expanded }}
        onPress={options?.onPress ?? (() => toggle(item))}
        style={[
          styles.chip,
          styles.historyChip,
          isDark && darkStyles.input,
          options?.secondary && styles.historyChildChip,
          isDark && options?.secondary && darkStyles.historyChildChip,
          options?.expanded && styles.historyParentExpanded,
          isDark && options?.expanded && darkStyles.historyParentExpanded,
          selected && styles.selectedButton,
          isDark && selected && darkStyles.selectedButton,
        ]}
      >
        <Text
          style={[
            styles.chipText,
            styles.historyChipText,
            isDark && darkStyles.secondaryText,
            options?.secondary && styles.historyChildChipText,
            isDark && options?.secondary && darkStyles.historyChildChipText,
            options?.expanded && styles.historyParentExpandedText,
            isDark && options?.expanded && darkStyles.historyParentExpandedText,
            selected && styles.selectedText,
          ]}
        >
          {options?.label ?? item}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.historyOptions}>
      <View style={styles.historyChipGrid}>
        {HISTORY_PRIMARY_OPTIONS.map((item) => historyChip(item))}
        {historyChip("뇌혈관", {
          expanded: cerebrovascularOpen,
          onPress: () =>
            cerebrovascularOpen
              ? closeGroup(CEREBROVASCULAR_OPTIONS, setCerebrovascularOpen)
              : setCerebrovascularOpen(true),
        })}
        {cerebrovascularOpen &&
          CEREBROVASCULAR_OPTIONS.map((item) =>
            historyChip(item, { secondary: true }),
          )}
        {historyChip("심혈관", {
          expanded: cardiovascularOpen,
          onPress: () =>
            cardiovascularOpen
              ? closeGroup(CARDIOVASCULAR_OPTIONS, setCardiovascularOpen)
              : setCardiovascularOpen(true),
        })}
        {cardiovascularOpen &&
          CARDIOVASCULAR_OPTIONS.map((item) =>
            historyChip(item, { secondary: true }),
          )}
        {historyChip("호흡기", {
          expanded: respiratoryOpen,
          onPress: () =>
            respiratoryOpen
              ? closeGroup(HISTORY_RESPIRATORY_OPTIONS, setRespiratoryOpen)
              : setRespiratoryOpen(true),
        })}
        {respiratoryOpen &&
          HISTORY_RESPIRATORY_OPTIONS.map((item) =>
            historyChip(item, { secondary: true }),
          )}
        {historyChip("신부전", {
          selected: renalSelected,
          onPress: () => {
            if (renalSelected) {
              DIALYSIS_OPTIONS.forEach((item) => {
                if (history.includes(item)) toggle(item);
              });
            }
            toggle("신부전");
          },
        })}
        {renalSelected &&
          DIALYSIS_OPTIONS.map((item) =>
            historyChip(item, {
              label: item.replace("투석 ", ""),
              secondary: true,
              onPress: () => {
                DIALYSIS_OPTIONS.forEach((option) => {
                  if (option !== item && history.includes(option))
                    toggle(option);
                });
                toggle(item);
              },
            }),
          )}
        {HISTORY_LAST_OPTIONS.map((item) => historyChip(item))}
      </View>
    </View>
  );
}

function SettingsPage({
  isDark,
  onToggleTheme,
}: {
  isDark: boolean;
  onToggleTheme: () => void;
}) {
  return (
    <View style={[styles.card, isDark && darkStyles.card]}>
      <View style={styles.pageHeading}>
        <Ionicons
          name="settings-outline"
          size={22}
          color={isDark ? "#67D2BC" : "#087F6D"}
        />
        <Text style={[styles.settingsTitle, isDark && darkStyles.primaryText]}>
          설정
        </Text>
      </View>
      <Text style={[styles.settingsLabel, isDark && darkStyles.secondaryText]}>
        화면
      </Text>
      <Pressable
        onPress={onToggleTheme}
        style={[styles.modeOption, isDark && darkStyles.input]}
      >
        <View style={styles.modeText}>
          <Text style={[styles.modeTitle, isDark && darkStyles.primaryText]}>
            {isDark ? "다크 모드" : "라이트 모드"}
          </Text>
          <Text
            style={[styles.modeCaption, isDark && darkStyles.secondaryText]}
          >
            눌러서 화면 모드를 전환합니다
          </Text>
        </View>
        <Ionicons
          name={isDark ? "moon" : "sunny"}
          size={21}
          color={isDark ? "#67D2BC" : "#087F6D"}
        />
      </Pressable>
    </View>
  );
}
function FuturePage({ isDark }: { isDark: boolean }) {
  return (
    <View style={[styles.card, styles.futureCard, isDark && darkStyles.card]}>
      <View style={styles.futureIcon}>
        <Ionicons name="people-outline" size={32} color="#087F6D" />
      </View>
      <Text style={[styles.futureTitle, isDark && darkStyles.primaryText]}>
        다수사상자
      </Text>
      <Text style={[styles.futureCaption, isDark && darkStyles.secondaryText]}>
        환자 분류·번호·이송 현황을 관리할 수 있도록 준비된 화면입니다.
      </Text>
      <View style={[styles.futureBadge, isDark && darkStyles.softButton]}>
        <Text style={[styles.futureBadgeText, isDark && darkStyles.accentText]}>
          개발 예정
        </Text>
      </View>
    </View>
  );
}
function BottomNavigation({
  activeTab,
  isDark,
  onSelect,
}: {
  activeTab: "memo" | "sals" | "mci" | "settings";
  isDark: boolean;
  onSelect: (tab: "memo" | "sals" | "mci" | "settings") => void;
}) {
  const items = [
    {
      key: "memo" as const,
      label: "메모",
      icon: "document-text-outline" as const,
    },
    { key: "sals" as const, label: "SALS", icon: "timer-outline" as const },
    {
      key: "mci" as const,
      label: "다수사상자",
      icon: "people-outline" as const,
    },
    {
      key: "settings" as const,
      label: "설정",
      icon: "settings-outline" as const,
    },
  ];
  return (
    <View style={[styles.bottomNav, isDark && darkStyles.bottomNav]}>
      {items.map((item) => {
        const selected = activeTab === item.key;
        return (
          <Pressable
            key={item.key}
            onPress={() => onSelect(item.key)}
            style={styles.bottomNavItem}
          >
            <Ionicons
              name={item.icon}
              size={21}
              color={
                selected
                  ? isDark
                    ? "#67D2BC"
                    : "#087F6D"
                  : isDark
                    ? "#8DA29C"
                    : "#8A9995"
              }
            />
            <Text
              style={[
                styles.bottomNavText,
                isDark && darkStyles.secondaryText,
                selected && styles.bottomNavTextActive,
                isDark && selected && darkStyles.bottomNavTextActive,
              ]}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
function SectionHeading({
  step,
  title,
  isDark,
}: {
  step: string;
  title: string;
  isDark: boolean;
}) {
  return (
    <View style={styles.sectionHeading}>
      <View style={styles.step}>
        <Text style={styles.stepText}>{step}</Text>
      </View>
      <Text style={[styles.sectionTitle, isDark && darkStyles.primaryText]}>
        {title}
      </Text>
    </View>
  );
}
function MemoCard({
  step,
  title,
  value,
  onsetDate,
  onsetTime,
  quickOptions,
  historyOptions = false,
  selectedOptions,
  drawingUri,
  placeholder,
  isDark,
  tall = false,
  onDraw,
  onChangeOnsetDate,
  onChangeOnsetTime,
  onToggleOption,
  onDeleteDrawing,
  onChange,
  onFocus,
  onLayout,
}: {
  step: string;
  title: string;
  value: string;
  onsetDate?: string;
  onsetTime?: string;
  quickOptions?: string[];
  historyOptions?: boolean;
  selectedOptions?: string[];
  drawingUri: string | null;
  placeholder: string;
  isDark: boolean;
  tall?: boolean;
  onDraw: () => void;
  onChangeOnsetDate?: (value: string) => void;
  onChangeOnsetTime?: (value: string) => void;
  onToggleOption?: (item: string) => void;
  onDeleteDrawing: () => void;
  onChange: (value: string) => void;
  onFocus: () => void;
  onLayout: (y: number) => void;
}) {
  const [previewVisible, setPreviewVisible] = useState(false);
  const [drawingAspectRatio, setDrawingAspectRatio] = useState(1.4);
  const [onsetNow, setOnsetNow] = useState(() => new Date());
  const onsetWeekday = onsetDate ? onsetWeekdayText(onsetDate) : null;
  useEffect(() => {
    if (onsetTime === undefined) return;
    const timer = setInterval(() => setOnsetNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, [onsetTime]);
  useEffect(() => {
    if (!drawingUri) return;
    Image.getSize(
      drawingUri,
      (width, height) => {
        if (width > 0 && height > 0) setDrawingAspectRatio(width / height);
      },
      () => setDrawingAspectRatio(1.4),
    );
  }, [drawingUri]);
  return (
    <View
      style={[styles.card, isDark && darkStyles.card]}
      onLayout={(event) => onLayout(event.nativeEvent.layout.y)}
    >
      <View style={styles.memoHeading}>
        <SectionHeading step={step} title={title} isDark={isDark} />
        <Pressable
          accessibilityLabel={`${title} 손글씨 메모`}
          onPress={onDraw}
          style={[styles.drawButton, isDark && darkStyles.drawButton]}
        >
          <Ionicons
            name="pencil"
            size={15}
            color={isDark ? "#67D2BC" : "#087F6D"}
          />
          <Text
            style={[styles.drawButtonText, isDark && darkStyles.drawButtonText]}
          >
            {drawingUri ? "수정" : "손글씨"}
          </Text>
        </Pressable>
      </View>
      {onsetTime !== undefined &&
        onsetDate !== undefined &&
        onChangeOnsetDate &&
        onChangeOnsetTime && (
          <View style={styles.onsetSection}>
            <Text style={[styles.label, isDark && darkStyles.secondaryText]}>
              Onset
            </Text>
            <View style={styles.onsetRow}>
              <View style={[styles.onsetDateBox, isDark && darkStyles.input]}>
                <TextInput
                  value={displayOnsetDate(onsetDate)}
                  onChangeText={(value) =>
                    onChangeOnsetDate(updateBirthDate(onsetDate, value))
                  }
                  keyboardType="number-pad"
                  maxLength={13}
                  placeholder="YYYY. MM. DD."
                  placeholderTextColor={isDark ? "#8DA29C" : "#9DA9A6"}
                  style={[
                    styles.onsetDateField,
                    !onsetWeekday && styles.onsetDateFieldEmpty,
                    isDark && darkStyles.primaryText,
                  ]}
                />
                {onsetWeekday && (
                  <Text
                    style={[
                      styles.onsetWeekdayInline,
                      isDark && darkStyles.primaryText,
                    ]}
                  >
                    ({onsetWeekday.slice(0, 1)})
                  </Text>
                )}
              </View>
              <TextInput
                value={displayOnsetTime(onsetTime)}
                onChangeText={onChangeOnsetTime}
                keyboardType="number-pad"
                maxLength={5}
                placeholder="HH:MM"
                placeholderTextColor={isDark ? "#8DA29C" : "#9DA9A6"}
                style={[styles.onsetInput, isDark && darkStyles.input]}
              />
              <Pressable
                onPress={() => {
                  const now = new Date();
                  onChangeOnsetDate(
                    `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`,
                  );
                  onChangeOnsetTime(
                    `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`,
                  );
                  setOnsetNow(now);
                }}
                style={styles.onsetNowButton}
              >
                <Text style={styles.nowText}>현재</Text>
              </Pressable>
            </View>
            {onsetElapsedText(onsetDate, onsetTime, onsetNow) && (
              <View
                style={[
                  styles.onsetElapsedBadge,
                  isDark && darkStyles.onsetElapsedBadge,
                ]}
              >
                <Ionicons
                  name="time-outline"
                  size={14}
                  color={isDark ? "#67D2BC" : "#087F6D"}
                />
                <Text
                  style={[styles.onsetElapsed, isDark && darkStyles.accentText]}
                >
                  {onsetElapsedText(onsetDate, onsetTime, onsetNow)}
                </Text>
              </View>
            )}
          </View>
        )}
      {quickOptions && selectedOptions && onToggleOption && (
        <View style={styles.memoQuickOptions}>
          {quickOptions.map((item) => {
            const selected = selectedOptions.includes(item);
            return (
              <Pressable
                key={item}
                onPress={() => onToggleOption(item)}
                style={[
                  styles.chip,
                  isDark && darkStyles.input,
                  selected && styles.selectedButton,
                  isDark && selected && darkStyles.selectedButton,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    isDark && darkStyles.secondaryText,
                    selected && styles.selectedText,
                  ]}
                >
                  {item}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
      {historyOptions && selectedOptions && onToggleOption && (
        <HistoryOptionPicker
          history={selectedOptions}
          isDark={isDark}
          toggle={onToggleOption}
        />
      )}
      <TextInput
        value={value}
        onChangeText={onChange}
        onFocus={onFocus}
        placeholder={placeholder}
        placeholderTextColor={isDark ? "#8DA29C" : "#9DA9A6"}
        multiline
        textAlignVertical="top"
        style={[
          styles.memoInput,
          tall && styles.memoInputTall,
          isDark && darkStyles.input,
        ]}
      />
      {drawingUri && (
        <SwipeToDelete
          accessibilityLabel="필기 메모 삭제"
          onDelete={onDeleteDrawing}
          containerStyle={[
            styles.drawingAttachment,
            { aspectRatio: drawingAspectRatio },
          ]}
          contentStyle={[
            styles.drawingAttachmentContent,
            isDark && darkStyles.input,
          ]}
        >
          <Pressable
            onPress={() => setPreviewVisible(true)}
            style={styles.drawingPreview}
          >
            <Image
              source={{ uri: drawingUri }}
              resizeMode="contain"
              style={styles.drawingThumbnail}
            />
            <View style={styles.drawingLabel}>
              <Ionicons name="expand-outline" size={16} color="#FFFFFF" />
              <Text style={styles.drawingLabelText}>보기</Text>
            </View>
          </Pressable>
        </SwipeToDelete>
      )}
      <Modal
        visible={previewVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setPreviewVisible(false)}
      >
        <Pressable
          style={styles.previewBackdrop}
          onPress={() => setPreviewVisible(false)}
        >
          <Image
            source={{ uri: drawingUri ?? undefined }}
            resizeMode="contain"
            style={styles.previewImage}
          />
          <View style={styles.previewClose}>
            <Ionicons name="close" size={27} color="#FFFFFF" />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function HandwritingModal({
  visible,
  isDark,
  title,
  initialUri,
  onClose,
  onSave,
}: {
  visible: boolean;
  isDark: boolean;
  title: string;
  initialUri: string | null;
  onClose: () => void;
  onSave: (uri: string) => void;
}) {
  const [paths, setPaths] = useState<
    { d: string; color: string; width: number }[]
  >([]);
  const [eraserEnabled, setEraserEnabled] = useState(false);
  const eraserEnabledRef = useRef(false);
  const [eraserWidth, setEraserWidth] = useState(44);
  const eraserWidthRef = useRef(44);
  const [eraserCursor, setEraserCursor] = useState({
    x: 0,
    y: 0,
    visible: false,
  });
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<View>(null);
  const inkColorRef = useRef(isDark ? "#FFFFFF" : "#132622");
  const canvasColorRef = useRef(isDark ? "#101916" : "#FFFFFF");
  inkColorRef.current = isDark ? "#FFFFFF" : "#132622";
  canvasColorRef.current = isDark ? "#101916" : "#FFFFFF";
  const activePath = useRef(-1);
  useEffect(() => {
    if (visible) {
      setPaths([]);
      setEraserEnabled(false);
      eraserEnabledRef.current = false;
      setEraserCursor({ x: 0, y: 0, visible: false });
      void AsyncStorage.getItem(ERASER_SIZE_KEY).then((saved) => {
        const parsed = Number(saved);
        if (!Number.isFinite(parsed)) return;
        const restored = Math.max(16, Math.min(200, parsed));
        setEraserWidth(restored);
        eraserWidthRef.current = restored;
      });
    }
  }, [visible]);
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        const { locationX, locationY } = event.nativeEvent;
        if (eraserEnabledRef.current)
          setEraserCursor({ x: locationX, y: locationY, visible: true });
        setPaths((previous) => {
          activePath.current = previous.length;
          return [
            ...previous,
            {
              d: `M ${locationX.toFixed(1)} ${locationY.toFixed(1)}`,
              color: eraserEnabledRef.current
                ? canvasColorRef.current
                : inkColorRef.current,
              width: eraserEnabledRef.current ? eraserWidthRef.current : 3.2,
            },
          ];
        });
      },
      onPanResponderMove: (event) => {
        const { locationX, locationY } = event.nativeEvent;
        if (eraserEnabledRef.current)
          setEraserCursor({ x: locationX, y: locationY, visible: true });
        setPaths((previous) =>
          previous.map((path, index) =>
            index === activePath.current
              ? {
                  ...path,
                  d: `${path.d} L ${locationX.toFixed(1)} ${locationY.toFixed(1)}`,
                }
              : path,
          ),
        );
      },
      onPanResponderRelease: () => {
        activePath.current = -1;
        setEraserCursor((previous) => ({ ...previous, visible: false }));
      },
      onPanResponderTerminate: () => {
        activePath.current = -1;
        setEraserCursor((previous) => ({ ...previous, visible: false }));
      },
    }),
  ).current;
  const save = async () => {
    if ((paths.length === 0 && !initialUri) || !canvasRef.current) return;
    try {
      setSaving(true);
      const uri = await captureRef(canvasRef, {
        format: "png",
        quality: 1,
        result: "tmpfile",
      });
      onSave(uri);
    } catch {
      Alert.alert("저장 오류", "필기 메모를 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      visible={visible}
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <SafeAreaView
        style={[styles.handwritingPage, isDark && darkStyles.handwritingPage]}
        edges={["top", "bottom"]}
      >
        <View style={styles.handwritingHeader}>
          <Pressable
            onPress={onClose}
            style={[
              styles.handwritingHeaderButton,
              isDark && darkStyles.handwritingHeaderButton,
            ]}
          >
            <Ionicons
              name="close"
              size={25}
              color={isDark ? "#FFFFFF" : "#17322C"}
            />
          </Pressable>
          <Text
            style={[
              styles.handwritingTitle,
              isDark && darkStyles.handwritingTitle,
            ]}
          >
            {title}
          </Text>
          <Pressable
            disabled={(paths.length === 0 && !initialUri) || saving}
            onPress={() => void save()}
            style={[
              styles.handwritingSave,
              (paths.length === 0 && !initialUri) || saving
                ? styles.disabledButton
                : undefined,
            ]}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.handwritingSaveText}>저장</Text>
            )}
          </Pressable>
        </View>
        <View
          ref={canvasRef}
          collapsable={false}
          style={[
            styles.handwritingCanvas,
            isDark && darkStyles.handwritingCanvas,
          ]}
          {...panResponder.panHandlers}
        >
          {initialUri && (
            <Image
              source={{ uri: initialUri }}
              resizeMode="stretch"
              style={StyleSheet.absoluteFill}
            />
          )}
          <Svg width="100%" height="100%">
            {paths.map((path, index) => (
              <Path
                key={`${index}-${path.d.length}`}
                d={path.d}
                fill="none"
                stroke={path.color}
                strokeWidth={path.width}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {eraserEnabled && eraserCursor.visible && (
              <Circle
                cx={eraserCursor.x}
                cy={eraserCursor.y}
                r={eraserWidth / 2}
                fill={
                  isDark ? "rgba(103,210,188,0.12)" : "rgba(8,127,109,0.08)"
                }
                stroke={isDark ? "#67D2BC" : "#087F6D"}
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            )}
          </Svg>
        </View>
        {eraserEnabled && (
          <EraserSizeSlider
            value={eraserWidth}
            isDark={isDark}
            onChange={(value) => {
              setEraserWidth(value);
              eraserWidthRef.current = value;
              void AsyncStorage.setItem(ERASER_SIZE_KEY, String(value));
            }}
          />
        )}
        <View style={styles.handwritingTools}>
          <Pressable
            onPress={() =>
              setEraserEnabled((previous) => {
                eraserEnabledRef.current = !previous;
                return !previous;
              })
            }
            style={[
              styles.handwritingTool,
              isDark && darkStyles.handwritingTool,
              eraserEnabled && styles.handwritingToolSelected,
            ]}
          >
            {eraserEnabled ? (
              <Ionicons name="pencil" size={20} color="#FFFFFF" />
            ) : (
              <MaterialCommunityIcons
                name="eraser"
                size={20}
                color={isDark ? "#F0F6F4" : "#315C54"}
              />
            )}
            <Text
              style={[
                styles.handwritingToolText,
                isDark && darkStyles.handwritingToolText,
                eraserEnabled && styles.handwritingToolSelectedText,
              ]}
            >
              {eraserEnabled ? "펜" : "지우개"}
            </Text>
          </Pressable>
          {paths.length > 0 && (
            <Pressable
              onPress={() => setPaths((previous) => previous.slice(0, -1))}
              style={[
                styles.handwritingTool,
                isDark && darkStyles.handwritingTool,
              ]}
            >
              <Ionicons
                name="arrow-undo"
                size={20}
                color={isDark ? "#F0F6F4" : "#315C54"}
              />
              <Text
                style={[
                  styles.handwritingToolText,
                  isDark && darkStyles.handwritingToolText,
                ]}
              >
                실행 취소
              </Text>
            </Pressable>
          )}
          <Pressable
            disabled={paths.length === 0}
            onPress={() => setPaths([])}
            style={[
              styles.handwritingTool,
              isDark && darkStyles.handwritingTool,
            ]}
          >
            <Ionicons name="trash-outline" size={20} color="#C62828" />
            <Text style={[styles.handwritingToolText, styles.dangerText]}>
              삭제
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function EraserSizeSlider({
  value,
  isDark,
  onChange,
}: {
  value: number;
  isDark: boolean;
  onChange: (value: number) => void;
}) {
  const min = 16;
  const max = 200;
  const trackWidth = useRef(1);
  const gestureStartValue = useRef(value);
  const [dragValue, setDragValue] = useState(value);
  const dragValueRef = useRef(value);
  useEffect(() => {
    setDragValue(value);
    dragValueRef.current = value;
  }, [value]);
  const updateFromPosition = (position: number) => {
    const ratio = Math.max(0, Math.min(1, position / trackWidth.current));
    const nextValue = min + ratio * (max - min);
    dragValueRef.current = nextValue;
    setDragValue(nextValue);
  };
  const updateFromDistance = (distance: number) => {
    const valuePerPixel = (max - min) / trackWidth.current;
    const nextValue = Math.max(
      min,
      Math.min(max, gestureStartValue.current + distance * valuePerPixel),
    );
    dragValueRef.current = nextValue;
    setDragValue(nextValue);
  };
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        updateFromPosition(event.nativeEvent.locationX);
        gestureStartValue.current = dragValueRef.current;
      },
      onPanResponderMove: (_, gesture) => updateFromDistance(gesture.dx),
      onPanResponderRelease: () => onChange(Math.round(dragValueRef.current)),
      onPanResponderTerminate: () => onChange(Math.round(dragValueRef.current)),
    }),
  ).current;
  const progress = (dragValue - min) / (max - min);
  return (
    <View style={[styles.eraserSizeBar, isDark && darkStyles.eraserSizeBar]}>
      <View style={styles.eraserSizePreviewFrame}>
        <MaterialCommunityIcons
          name="eraser"
          size={25}
          color={isDark ? "#67D2BC" : "#087F6D"}
        />
      </View>
      <View style={styles.eraserSliderBody}>
        <View style={styles.eraserSizeLabelRow}>
          <Text
            style={[
              styles.eraserSizeLabel,
              isDark && darkStyles.eraserSizeLabel,
            ]}
          >
            지우개 크기
          </Text>
          <Text style={styles.eraserSizeValue}>{Math.round(dragValue)}px</Text>
        </View>
        <View
          {...panResponder.panHandlers}
          onLayout={(event) => {
            trackWidth.current = event.nativeEvent.layout.width;
          }}
          style={styles.eraserSliderTouch}
        >
          <View
            style={[
              styles.eraserSliderTrack,
              isDark && darkStyles.eraserSliderTrack,
            ]}
          >
            <View
              style={[styles.eraserSliderFill, { width: `${progress * 100}%` }]}
            />
            <View
              style={[styles.eraserSliderThumb, { left: `${progress * 100}%` }]}
            />
          </View>
        </View>
      </View>
    </View>
  );
}

const PRETENDARD_BY_WEIGHT = {
  regular: "Pretendard-Regular",
  medium: "Pretendard-Medium",
  semiBold: "Pretendard-SemiBold",
  bold: "Pretendard-Bold",
} as const;

function withPretendard<T extends StyleSheet.NamedStyles<T>>(source: T): T {
  return Object.fromEntries(
    Object.entries(normalizeDesign(source)).map(([name, style]) => {
      const typedStyle = style as Record<string, unknown>;
      if (!("fontSize" in typedStyle)) return [name, style];
      const numericWeight = Number(typedStyle.fontWeight ?? 400);
      const fontFamily =
        numericWeight >= 700
          ? PRETENDARD_BY_WEIGHT.bold
          : numericWeight >= 600
            ? PRETENDARD_BY_WEIGHT.semiBold
            : numericWeight >= 500
              ? PRETENDARD_BY_WEIGHT.medium
              : PRETENDARD_BY_WEIGHT.regular;
      return [name, { ...typedStyle, fontFamily, fontWeight: undefined }];
    }),
  ) as T;
}

const styles = StyleSheet.create(
  withPretendard({
    birthInputRow: { flexDirection: "row", gap: 8 },
    birthInput: { flex: 1 },
    ageDisplay: {
      width: 82,
      height: 46,
      borderRadius: 11,
      backgroundColor: "#E3F4F0",
      alignItems: "center",
      justifyContent: "center",
    },
    agePlaceholder: { color: "#8A9995", fontSize: 12, fontWeight: "600" },
    documentEqualWidth: { flex: 1, width: "auto" },
    documentCardEqualWidth: { width: "100%" },
    memoHeading: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    drawButton: {
      minHeight: 32,
      borderRadius: 9,
      backgroundColor: "#E8F3F0",
      paddingHorizontal: 9,
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    drawButtonText: { color: "#087F6D", fontSize: 11, fontWeight: "700" },
    drawingAttachment: {
      width: "100%",
      marginTop: 9,
      borderRadius: 12,
    },
    drawingAttachmentContent: {
      flex: 1,
      width: "100%",
      borderRadius: 12,
      backgroundColor: "#FAFCFB",
      overflow: "hidden",
    },
    drawingPreview: { flex: 1 },
    drawingThumbnail: {
      width: "100%",
      height: "100%",
      backgroundColor: "#FFFFFF",
    },
    drawingLabel: {
      position: "absolute",
      right: 9,
      top: 9,
      minHeight: 27,
      borderRadius: 8,
      paddingHorizontal: 8,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 5,
      opacity: 0.62,
      backgroundColor: "rgba(15,34,30,0.62)",
    },
    drawingLabelText: { color: "#FFFFFF", fontSize: 10, fontWeight: "700" },
    drawingDelete: {
      width: 46,
      alignItems: "center",
      justifyContent: "center",
      borderLeftWidth: 1,
      borderLeftColor: "#DDE5E3",
      backgroundColor: "#FFFFFF",
    },
    handwritingPage: {
      flex: 1,
      backgroundColor: "#EFF3F2",
      paddingHorizontal: 15,
    },
    handwritingHeader: {
      height: 62,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    handwritingHeaderButton: {
      width: 42,
      height: 42,
      borderRadius: 12,
      backgroundColor: "#FFFFFF",
      alignItems: "center",
      justifyContent: "center",
    },
    handwritingTitle: { color: "#17322C", fontSize: 17, fontWeight: "900" },
    handwritingSave: {
      minWidth: 74,
      height: 42,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: "#087F6D",
      backgroundColor: "#087F6D",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 7,
      paddingHorizontal: 12,
    },
    handwritingSaveText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
    handwritingCanvas: {
      flex: 1,
      backgroundColor: "#FFFFFF",
      borderRadius: 16,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: "#D4DEDB",
    },
    handwritingTools: {
      height: 72,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
    },
    handwritingTool: {
      height: 42,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: "#D5E0DD",
      backgroundColor: "#FFFFFF",
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 7,
    },
    handwritingToolText: { color: "#315C54", fontSize: 13, fontWeight: "800" },
    handwritingToolSelected: {
      backgroundColor: "#087F6D",
      borderColor: "#087F6D",
    },
    handwritingToolSelectedText: { color: "#FFFFFF" },
    eraserSizeBar: {
      height: 72,
      marginTop: 10,
      borderRadius: 12,
      backgroundColor: "#FFFFFF",
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    eraserSizePreviewFrame: {
      width: 48,
      height: 48,
      alignItems: "center",
      justifyContent: "center",
    },
    eraserSliderBody: { flex: 1 },
    eraserSizeLabelRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    eraserSizeLabel: {
      color: "#586A66",
      fontSize: 11,
      fontWeight: "800",
    },
    eraserSizeValue: { color: "#087F6D", fontSize: 11, fontWeight: "900" },
    eraserSliderTouch: { height: 30, justifyContent: "center" },
    eraserSliderTrack: {
      height: 5,
      borderRadius: 3,
      backgroundColor: "#DCE7E4",
    },
    eraserSliderFill: {
      height: 5,
      borderRadius: 3,
      backgroundColor: "#087F6D",
    },
    eraserSliderThumb: {
      position: "absolute",
      top: -6,
      width: 17,
      height: 17,
      marginLeft: -8.5,
      borderRadius: 9,
      borderWidth: 3,
      borderColor: "#FFFFFF",
      backgroundColor: "#087F6D",
      shadowColor: "#173F37",
      shadowOpacity: 0.22,
      shadowRadius: 3,
      elevation: 2,
    },
    swipeContainer: {
      overflow: "hidden",
      backgroundColor: "#C62828",
    },
    swipeContent: {
      flex: 1,
      backgroundColor: "#FFFFFF",
    },
    swipeDeleteAction: {
      ...StyleSheet.absoluteFillObject,
      alignItems: "flex-end",
      justifyContent: "center",
      paddingRight: 18,
    },
    swipeDeleteText: {
      color: "#FFFFFF",
      fontSize: 10,
      fontWeight: "900",
      marginTop: 3,
      textAlign: "center",
    },
    flex: { flex: 1 },
    safe: { flex: 1, backgroundColor: "#F3F6F5" },
    loading: { flex: 1, alignItems: "center", justifyContent: "center" },
    intro: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 100,
      backgroundColor: "#F7FCFA",
    },
    introImageWrap: { flex: 1, backgroundColor: "#F7FCFA" },
    introImage: { width: "100%", height: "100%" },
    introDim: { ...StyleSheet.absoluteFillObject, backgroundColor: "#001C1E" },
    page: { paddingHorizontal: 15, paddingTop: 17, paddingBottom: 38, gap: 12 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 1,
    },
    headerActions: { flexDirection: "row", alignItems: "center", gap: 7 },
    title: {
      color: "#102A25",
      fontSize: 27,
      fontWeight: "800",
      letterSpacing: -0.7,
    },
    iconButton: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: "#E3ECEA",
      alignItems: "center",
      justifyContent: "center",
    },
    resetButton: {
      backgroundColor: "#E3ECEA",
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    resetText: { color: "#315C54", fontWeight: "700", fontSize: 13 },
    card: {
      backgroundColor: "#FFFFFF",
      borderRadius: 18,
      borderWidth: 1,
      borderColor: "#E8EEEC",
      padding: 16,
      shadowColor: "#173F37",
      shadowOpacity: 0.045,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 1,
    },
    sectionHeading: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 13,
    },
    step: {
      width: 25,
      height: 25,
      backgroundColor: "#087F6D",
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 9,
    },
    stepText: { color: "#FFFFFF", fontWeight: "800", fontSize: 13 },
    sectionTitle: {
      color: "#17322C",
      fontSize: 18,
      lineHeight: 23,
      fontWeight: "800",
      includeFontPadding: false,
    },
    memoInput: {
      minHeight: 104,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: "#DDE5E3",
      backgroundColor: "#FAFCFB",
      paddingHorizontal: 13,
      paddingTop: 11,
      paddingBottom: 11,
      color: "#17322C",
      fontSize: 15,
      lineHeight: 22,
      fontWeight: "400",
      includeFontPadding: false,
    },
    memoInputTall: { minHeight: 138 },
    onsetSection: { marginBottom: 13 },
    onsetRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    onsetDayRow: { flexDirection: "row", gap: 5 },
    onsetDayButton: {
      height: 42,
      minWidth: 48,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: "#DDE5E3",
      backgroundColor: "#FAFCFB",
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 9,
    },
    onsetDayText: { color: "#536A65", fontSize: 12, fontWeight: "800" },
    onsetInput: {
      flex: 0.66,
      height: 46,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: "#DDE5E3",
      backgroundColor: "#FAFCFB",
      color: "#17322C",
      fontSize: 16,
      fontWeight: "600",
      fontVariant: ["tabular-nums"],
      textAlign: "left",
      textAlignVertical: "center",
      includeFontPadding: false,
      paddingHorizontal: 12,
      paddingVertical: 0,
    },
    onsetDateBox: {
      flex: 1.56,
      height: 46,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: "#DDE5E3",
      backgroundColor: "#FAFCFB",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-start",
      gap: 4,
      paddingHorizontal: 12,
    },
    onsetDateField: {
      width: 104,
      height: 44,
      color: "#17322C",
      fontSize: 16,
      fontWeight: "600",
      fontVariant: ["tabular-nums"],
      textAlign: "left",
      textAlignVertical: "center",
      includeFontPadding: false,
      paddingLeft: 0,
      paddingRight: 0,
      paddingVertical: 0,
    },
    onsetDateFieldEmpty: { flex: 1, width: "auto" },
    onsetWeekdayInline: {
      color: "#17322C",
      fontSize: 16,
      fontWeight: "600",
      fontVariant: ["tabular-nums"],
      lineHeight: 20,
      includeFontPadding: false,
    },
    onsetNowButton: {
      width: 60,
      height: 46,
      borderRadius: 11,
      backgroundColor: "#087F6D",
      alignItems: "center",
      justifyContent: "center",
    },
    onsetElapsedBadge: {
      alignSelf: "flex-end",
      minHeight: 29,
      borderRadius: 9,
      backgroundColor: "#E8F5F2",
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 9,
      marginTop: 8,
    },
    onsetElapsed: {
      color: "#087F6D",
      fontSize: 12,
      fontWeight: "700",
    },
    memoQuickOptions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 13,
    },
    historyOptions: {
      gap: 8,
      marginTop: 10,
      marginBottom: 13,
    },
    historyChipGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
    },
    historyChip: {
      minHeight: 32,
      borderRadius: 9,
      paddingHorizontal: 10,
    },
    historyChipText: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "600",
    },
    historyChildChip: {
      backgroundColor: "#E9F6F3",
      borderColor: "#38A58F",
      borderWidth: 1.5,
    },
    historyChildChipText: { color: "#176F60" },
    historyParentExpanded: {
      backgroundColor: "#E8ECEB",
      borderColor: "#B9C4C1",
    },
    historyParentExpandedText: { color: "#7A8985" },
    singleInput: {
      height: 46,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: "#DDE5E3",
      backgroundColor: "#FAFCFB",
      paddingHorizontal: 12,
      paddingVertical: 0,
      color: "#17322C",
      fontSize: 16,
      fontWeight: "600",
      fontVariant: ["tabular-nums"],
      textAlignVertical: "center",
      includeFontPadding: false,
      marginBottom: 10,
    },
    birthLabelRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    birthLabel: { marginBottom: 5 },
    ageBadge: {
      minHeight: 24,
      borderRadius: 8,
      backgroundColor: "#E3F4F0",
      paddingHorizontal: 9,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 5,
    },
    ageText: { color: "#087F6D", fontSize: 12, fontWeight: "700" },
    segmentRow: { flexDirection: "row", gap: 8 },
    segmentButton: {
      flex: 1,
      height: 42,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: "#DDE5E3",
      backgroundColor: "#FAFCFB",
      alignItems: "center",
      justifyContent: "center",
    },
    documentRow: { flexDirection: "row", gap: 8, marginTop: 10 },
    scanButton: {
      minHeight: 51,
      borderRadius: 11,
      backgroundColor: "#F0F8F6",
      marginTop: 10,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 9,
    },
    scanButtonCompact: { flex: 1, marginTop: 0 },
    disabledButton: { opacity: 0.62 },
    scanTitle: { color: "#17473E", fontSize: 12, fontWeight: "700" },
    scanCaption: { color: "#71817E", fontSize: 10, marginTop: 2 },
    documentSwipe: {
      width: 108,
      height: 64,
      borderRadius: 11,
      overflow: "hidden",
      backgroundColor: "#C62828",
    },
    documentDelete: {
      ...StyleSheet.absoluteFillObject,
      paddingRight: 10,
      alignItems: "flex-end",
      justifyContent: "center",
    },
    documentDeleteText: {
      color: "#FFFFFF",
      fontSize: 9,
      fontWeight: "800",
      marginTop: 1,
    },
    documentCard: {
      width: 108,
      height: 64,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: "#DDE5E3",
      backgroundColor: "#FAFCFB",
      overflow: "hidden",
    },
    documentPreviewButton: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 7,
    },
    documentViewText: { color: "#17322C", fontSize: 13, fontWeight: "900" },
    previewBackdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.94)",
      alignItems: "center",
      justifyContent: "center",
    },
    previewImage: { width: "96%", height: "90%" },
    previewClose: {
      position: "absolute",
      top: 52,
      right: 20,
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: "rgba(0,0,0,0.62)",
      alignItems: "center",
      justifyContent: "center",
    },
    swipeHint: {
      color: "#71817E",
      fontSize: 9,
      textAlign: "right",
      marginTop: 5,
    },
    chip: {
      minHeight: 38,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: "#DDE5E3",
      backgroundColor: "#FAFCFB",
      paddingHorizontal: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    chipText: {
      color: "#536A65",
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "600",
      includeFontPadding: false,
    },
    selectedButton: { backgroundColor: "#087F6D", borderColor: "#087F6D" },
    selectedText: { color: "#FFFFFF" },
    detailLabel: { marginTop: 14 },
    label: {
      color: "#586A66",
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "700",
      includeFontPadding: false,
      marginBottom: 7,
    },
    timeRow: { flexDirection: "row", gap: 7 },
    timeDisplay: {
      flex: 1,
      height: 46,
      borderRadius: 12,
      backgroundColor: "#FAFCFB",
      borderWidth: 1,
      borderColor: "#DDE5E3",
      justifyContent: "center",
      paddingHorizontal: 12,
    },
    timeValue: {
      color: "#17322C",
      fontSize: 16,
      lineHeight: 20,
      fontWeight: "600",
      fontVariant: ["tabular-nums"],
      includeFontPadding: false,
    },
    placeholder: {
      color: "#A0AAA8",
      fontSize: 16,
      lineHeight: 20,
      fontWeight: "600",
      fontVariant: ["tabular-nums"],
      includeFontPadding: false,
    },
    nowButton: {
      width: 70,
      height: 46,
      borderRadius: 12,
      backgroundColor: "#087F6D",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
    },
    nowText: {
      color: "#FFFFFF",
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "700",
      includeFontPadding: false,
    },
    divider: { height: 1, backgroundColor: "#EDF1F0", marginVertical: 12 },
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      rowGap: 7,
    },
    vitalBox: {
      width: "48.7%",
      borderWidth: 1,
      borderColor: "#DDE5E3",
      backgroundColor: "#FAFCFB",
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingTop: 8,
      paddingBottom: 5,
    },
    vitalTop: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      minHeight: 20,
    },
    vitalLabel: {
      color: "#087F6D",
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "800",
      includeFontPadding: false,
    },
    unit: {
      color: "#84918E",
      fontSize: 10,
      lineHeight: 15,
      fontWeight: "500",
      includeFontPadding: false,
    },
    vitalValueRow: {
      height: 40,
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    vitalInput: {
      flex: 1,
      minWidth: 0,
      color: "#17322C",
      fontSize: 20,
      fontWeight: "600",
      height: 40,
      paddingHorizontal: 0,
      paddingVertical: 0,
      textAlignVertical: "center",
      includeFontPadding: false,
    },
    mapBadge: {
      minHeight: 23,
      borderRadius: 7,
      backgroundColor: "#DDF2ED",
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 8,
      marginBottom: 1,
    },
    mapBadgeEmpty: { backgroundColor: "#EEF2F1" },
    mapBadgeDanger: {
      backgroundColor: "#FDE8E7",
      borderWidth: 1,
      borderColor: "#F4B4B0",
    },
    mapLabel: {
      color: "#087F6D",
      fontSize: 10,
      fontWeight: "800",
      marginRight: 6,
    },
    mapValue: { color: "#17473E", fontSize: 14, fontWeight: "700" },
    mapEmpty: { color: "#9AA6A3" },
    mapUnit: { color: "#71817E", fontSize: 9, marginLeft: 3 },
    dangerText: { color: "#C62828" },
    dangerSubText: { color: "#A94343" },
    settingsTitle: { color: "#17322C", fontSize: 21, fontWeight: "900" },
    settingsLabel: {
      color: "#586A66",
      fontSize: 12,
      fontWeight: "800",
      marginBottom: 1,
    },
    pageHeading: {
      flexDirection: "row",
      alignItems: "center",
      gap: 9,
      marginBottom: 12,
    },
    modeOption: {
      minHeight: 66,
      borderRadius: 13,
      borderWidth: 1,
      borderColor: "#DDE5E3",
      backgroundColor: "#FAFCFB",
      paddingHorizontal: 14,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginBottom: 8,
    },
    modeText: { flex: 1 },
    modeTitle: { color: "#17322C", fontSize: 15, fontWeight: "900" },
    modeCaption: { color: "#71817E", fontSize: 11, marginTop: 3 },
    bottomNav: {
      height: 70,
      paddingBottom: 7,
      flexDirection: "row",
      borderTopWidth: 1,
      borderTopColor: "#DDE5E3",
      backgroundColor: "#FFFFFF",
    },
    bottomNavItem: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 3,
    },
    bottomNavText: { color: "#8A9995", fontSize: 10, fontWeight: "700" },
    bottomNavTextActive: { color: "#087F6D", fontWeight: "900" },
    futureCard: {
      minHeight: 360,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 30,
    },
    futureIcon: {
      width: 68,
      height: 68,
      borderRadius: 22,
      backgroundColor: "#E3F4F0",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 16,
    },
    futureTitle: { color: "#17322C", fontSize: 24, fontWeight: "900" },
    futureCaption: {
      color: "#71817E",
      fontSize: 13,
      lineHeight: 20,
      textAlign: "center",
      marginTop: 8,
    },
    futureBadge: {
      backgroundColor: "#E3ECEA",
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 7,
      marginTop: 18,
    },
    futureBadgeText: { color: "#087F6D", fontSize: 12, fontWeight: "900" },
    cprElapsedTime: {
      color: "#D23B58",
      fontSize: 28,
      fontWeight: "900",
      letterSpacing: 0.4,
      fontVariant: ["tabular-nums"],
    },
    compressionCountdown: {
      color: "#087F6D",
      fontSize: 10,
      fontWeight: "900",
      marginTop: 3,
      fontVariant: ["tabular-nums"],
    },
    compressionCountdownDone: { color: "#D23B58" },
    cameraPage: { flex: 1, backgroundColor: "#07110F" },
    cameraOverlay: {
      flex: 1,
      justifyContent: "space-between",
      alignItems: "center",
      backgroundColor: "rgba(0,0,0,0.2)",
      paddingBottom: 34,
    },
    cameraHeader: {
      width: "100%",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingTop: 52,
    },
    cameraClose: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: "rgba(0,0,0,0.55)",
      alignItems: "center",
      justifyContent: "center",
    },
    cameraTitle: {
      color: "#FFFFFF",
      fontSize: 17,
      fontWeight: "900",
      textShadowColor: "rgba(0,0,0,0.7)",
      textShadowRadius: 4,
    },
    cameraHeaderSpace: { width: 42 },
    guideWrap: { width: "100%", alignItems: "center" },
    guide: {
      width: "88%",
      aspectRatio: 1.58,
      borderWidth: 2,
      borderColor: "#84F0D9",
      borderRadius: 18,
    },
    guideText: {
      color: "#FFFFFF",
      fontSize: 15,
      fontWeight: "800",
      marginTop: 16,
      textShadowColor: "rgba(0,0,0,0.8)",
      textShadowRadius: 4,
    },
    guideSub: {
      color: "#E1ECE9",
      fontSize: 12,
      marginTop: 6,
      textShadowColor: "rgba(0,0,0,0.8)",
      textShadowRadius: 4,
    },
    shutterOuter: {
      width: 76,
      height: 76,
      borderRadius: 38,
      borderWidth: 4,
      borderColor: "#FFFFFF",
      padding: 5,
    },
    shutterInner: {
      flex: 1,
      borderRadius: 31,
      backgroundColor: "#FFFFFF",
      alignItems: "center",
      justifyContent: "center",
    },
  }),
);
const darkStyles = StyleSheet.create({
  appBackground: { backgroundColor: "#0C1412" },
  safe: { backgroundColor: "#0C1412" },
  card: {
    backgroundColor: "#17211E",
    borderColor: "#23322E",
    shadowOpacity: 0,
    elevation: 0,
  },
  primaryText: { color: "#F0F6F4" },
  secondaryText: { color: "#B7C8C3" },
  tertiaryText: { color: "#9AAEA8" },
  placeholderText: { color: "#8DA29C" },
  emptyText: { color: "#8DA29C" },
  accentText: { color: "#67D2BC" },
  onsetElapsedBadge: { backgroundColor: "#17352F" },
  softButton: { backgroundColor: "#24332F" },
  softButtonText: { color: "#D4E3DF" },
  drawButton: {
    backgroundColor: "#101916",
    borderWidth: 1,
    borderColor: "#3A4D47",
  },
  drawButtonText: { color: "#FFFFFF" },
  handwritingPage: { backgroundColor: "#0C1412" },
  handwritingHeaderButton: { backgroundColor: "#17211E" },
  handwritingTitle: { color: "#FFFFFF" },
  handwritingCanvas: {
    backgroundColor: "#101916",
    borderColor: "#3A4D47",
  },
  handwritingTool: {
    backgroundColor: "#17211E",
    borderColor: "#3A4D47",
  },
  handwritingToolText: { color: "#F0F6F4" },
  eraserSizeBar: { backgroundColor: "#17211E" },
  eraserSizeLabel: { color: "#B7C8C3" },
  eraserSliderTrack: { backgroundColor: "#354741" },
  input: {
    backgroundColor: "#101916",
    borderColor: "#3A4D47",
    color: "#F0F6F4",
  },
  selectedButton: { backgroundColor: "#176F60", borderColor: "#59D2BC" },
  historyChildChip: {
    backgroundColor: "#17352F",
    borderColor: "#67D2BC",
    borderWidth: 1.5,
  },
  historyChildChipText: { color: "#91E1D1" },
  historyParentExpanded: {
    backgroundColor: "#222D2A",
    borderColor: "#465650",
  },
  historyParentExpandedText: { color: "#91A09C" },
  divider: { backgroundColor: "#354741" },
  mapBadge: { backgroundColor: "#17352F" },
  mapBadgeDanger: { backgroundColor: "#451F21", borderColor: "#A65459" },
  dangerText: { color: "#FF8A80" },
  dangerSubText: { color: "#FFB4AE" },
  bottomNav: { backgroundColor: "#121C19", borderTopColor: "#354741" },
  bottomNavTextActive: { color: "#67D2BC" },
});
