/** 주민등록증/운전면허증 OCR 문자열에서 생년월일만 추출합니다. */
export function extractBirthDate(text: string, today = new Date()): string | null {
  const normalized = text.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1");

  // 1990. 01. 23 / 1990-01-23 / 19900123
  const full = normalized.match(/(?:19|20)\d{2}\s*[.\-/년]?\s*(?:0?[1-9]|1[0-2])\s*[.\-/월]?\s*(?:0?[1-9]|[12]\d|3[01])/);
  if (full) {
    const digits = full[0].replace(/\D/g, "");
    const value = digits.slice(0, 8);
    return isValidBirthDate(value, today) ? value : null;
  }

  // 주민등록번호 앞 6자리 + 성별/세기 구분 숫자. 뒤 6자리는 읽지도 저장하지도 않습니다.
  const resident = normalized.match(/(\d{2})\s*(\d{2})\s*(\d{2})\s*[-‐‑‒–—―]?\s*([0-9])/);
  if (!resident) return null;
  const [, yy, mm, dd, code] = resident;
  if (!yy || !mm || !dd || !code) return null;
  const century: Record<string, string> = {
    "9": "18", "0": "18", "1": "19", "2": "19", "5": "19", "6": "19",
    "3": "20", "4": "20", "7": "20", "8": "20"
  };
  const prefix = century[code];
  if (!prefix) return null;
  const value = `${prefix}${yy}${mm}${dd}`;
  return isValidBirthDate(value, today) ? value : null;
}

export function isValidBirthDate(value: string, today = new Date()): boolean {
  const digits = value.replace(/\D/g, "");
  if (!/^\d{8}$/.test(digits)) return false;
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day && date <= today;
}

export function calculateAge(value: string, today = new Date()): number | null {
  if (!isValidBirthDate(value, today)) return null;
  const digits = value.replace(/\D/g, "");
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  let age = today.getFullYear() - year;
  if (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)) age--;
  return age;
}

export type ScannedIdentity = {
  name: string | null;
  birthDate: string | null;
  gender: "남성" | "여성" | null;
};

type OcrLine = { text: string; frame: { left: number; top: number; right: number; bottom: number } };
type OcrResult = { text: string; blocks: { lines: OcrLine[] }[] };
export type IdentityRegion = { left: number; top: number; right: number; bottom: number };

// 면허번호(예: 18-04-007412-90)와 혼동하지 않도록 생년월일 6자리는 연속 숫자만 허용합니다.
// OCR이 주민번호 하이픈을 빠뜨리는 경우가 있어 생년월일 뒤 구분선만 선택적으로 허용합니다.
const residentNumberPattern = /(\d{2})\s*(\d{2})\s*(\d{2})\s*[-‐‑‒–—―]?\s*([0-9])/;
const identityWords = /(복지카드|주민등록증|자동차운전면허증|운전면허증|대한민국|경찰청|시장|도지사|특별시|광역시|군수|구청장|주소|면허|번호|적성검사|발급|유효기간|장애|등급)/;

export function findIdentityRegion(result: OcrResult): IdentityRegion | null {
  const residentLine = result.blocks.flatMap((block) => block.lines).find((line) => {
    const normalized = line.text.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1");
    return residentNumberPattern.test(normalized) && extractBirthDate(normalized) !== null;
  });
  if (!residentLine) return null;
  const lineHeight = Math.max(1, residentLine.frame.bottom - residentLine.frame.top);
  const lineWidth = Math.max(1, residentLine.frame.right - residentLine.frame.left);
  return {
    left: Math.max(0, residentLine.frame.left - lineWidth * 0.2),
    top: Math.max(0, residentLine.frame.top - lineHeight * 3.2),
    right: residentLine.frame.right + lineWidth * 0.2,
    bottom: residentLine.frame.bottom + lineHeight * 0.65,
  };
}

function extractNameFromLine(value: string): string | null {
  const labeled = value.match(/(?:성\s*명|이\s*름)\s*[:：]?\s*((?:[가-힣]\s*){2,5})/u)?.[1]?.replace(/\s/g, "");
  if (labeled) return labeled;
  // 운전면허 종별(1종대형, 1종보통 등)처럼 숫자가 섞인 줄은 성명 후보가 아닙니다.
  if (/\d/.test(value) || /(?:[12]\s*종|대형|보통|소형|특수)/.test(value)) return null;
  const withoutHanja = value.replace(/[（(][^)）]*[)）]/g, " ");
  const koreanOnly = withoutHanja.replace(/[^가-힣\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (!/^(?:[가-힣]\s*){2,5}$/u.test(koreanOnly)) return null;
  const candidate = koreanOnly.replace(/\s/g, "");
  return candidate.length >= 2 && candidate.length <= 5 && !identityWords.test(candidate) ? candidate : null;
}

/** 카드 종류와 무관하게 OCR 결과에서 필요한 최소 정보만 골라 반환합니다. */
export function extractIdentity(text: string, today = new Date()): ScannedIdentity {
  const normalized = text.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1");
  const resident = extractBirthDate(normalized, today) ? normalized.match(residentNumberPattern) : null;
  const genderCode = resident?.[4];
  const maleCodes = new Set(["1", "3", "5", "7", "9"]);
  const femaleCodes = new Set(["0", "2", "4", "6", "8"]);
  let gender: ScannedIdentity["gender"] = genderCode && maleCodes.has(genderCode) ? "남성" : genderCode && femaleCodes.has(genderCode) ? "여성" : null;
  if (!gender && /(?:성별\s*[:：]?\s*)?(?:남성|남자|\b남\b)/.test(text)) gender = "남성";
  if (!gender && /(?:성별\s*[:：]?\s*)?(?:여성|여자|\b여\b)/.test(text)) gender = "여성";

  const blocked = /(주민등록증|운전면허증|복지카드|장애인|대한민국|경찰청|시장|도지사|특별시|광역시|군수|구청장|주소|성명|이름|면허|번호|적성검사|발급|보건복지부)/;
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const labeled = lines
    .map((line) => line.match(/(?:성\s*명|이\s*름)\s*[:：]?\s*((?:[가-힣]\s*){2,5})/u)?.[1]?.replace(/\s/g, ""))
    .find(Boolean);
  const candidates = lines
    .filter((line) => !/\d/.test(line) && !/(?:[12]\s*종|대형|보통|소형|특수)/.test(line))
    .map((line) => line.replace(/[^가-힣\s]/gu, " ").replace(/\s+/g, " ").trim())
    .filter((line) => /^(?:[가-힣]\s*){2,5}$/u.test(line) && !blocked.test(line))
    .map((line) => line.replace(/\s/g, ""));

  return { name: labeled ?? candidates[0] ?? null, birthDate: extractBirthDate(normalized, today), gender };
}

/** 주민번호 줄을 기준으로 바로 위 성명 영역을 우선 탐색합니다. */
export function extractIdentityFromOcr(result: OcrResult, today = new Date()): ScannedIdentity {
  const identity = extractIdentity(result.text, today);
  const lines = result.blocks.flatMap((block) => block.lines);
  const residentLine = lines.find((line) => {
    const normalized = line.text.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1");
    return residentNumberPattern.test(normalized) && extractBirthDate(normalized, today) !== null;
  });
  if (!residentLine) return identity;

  const sameLineName = extractNameFromLine(residentLine.text.replace(residentNumberPattern, " "));
  const numberHeight = Math.max(1, residentLine.frame.bottom - residentLine.frame.top);
  const nearbyName = lines
    .filter((line) => line !== residentLine && line.frame.bottom <= residentLine.frame.top + numberHeight * 0.35)
    .map((line) => ({
      name: extractNameFromLine(line.text),
      verticalGap: Math.max(0, residentLine.frame.top - line.frame.bottom),
      horizontalGap: Math.abs(line.frame.left - residentLine.frame.left),
    }))
    .filter((candidate) => candidate.name && candidate.verticalGap <= numberHeight * 4.5)
    .sort((a, b) => (a.verticalGap + a.horizontalGap * 0.15) - (b.verticalGap + b.horizontalGap * 0.15))[0]?.name;

  return { ...identity, name: sameLineName ?? nearbyName ?? identity.name };
}
