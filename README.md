# EMS Log

기존 `ems-log-downloads` 저장소를 앱 소스와 Android APK 릴리스 관리에 함께 사용합니다. 기존 배포 안내: EMS Log Android APK downloads and release notes.

저장소: https://github.com/jangseong85/ems-log-downloads

소스 푸시만으로 APK 또는 홈페이지가 자동 업데이트되지는 않습니다. APK는 별도 빌드 후 Releases에 게시합니다. 디자인 기준은 `docs/DESIGN_SYSTEM.md`, 신규 SALS 동작은 `docs/SALS_TIMERS.md`를 참고하세요.

현장에서 환자 정보와 활력징후를 빠르게 기록하는 iOS/Android 앱입니다.

## 현재 기능

- 성함, 생년월일 8자리(`YYYYMMDD`), 성별 입력 및 만 나이 자동 계산
- 한국시간 기준 측정 시각 원터치 입력
- BP, PR, RR, SpO₂, BT, BST 입력
- 작성 중인 내용을 기기 내부에 자동 저장
- 주민등록증, 운전면허증, 복지카드 등 신분증 OCR
  - 성함·생년월일·성별만 앱에 반영
  - 촬영 사진과 OCR 원문, 주민등록번호 뒷자리는 저장하지 않음
  - 카드에 성별 근거가 인쇄되지 않은 경우 성별은 직접 선택

## 실행

ML Kit은 네이티브 모듈이므로 Expo Go가 아닌 개발 빌드가 필요합니다.

```bash
npm install
npx expo run:android -d
# 또는 실제 iPhone 연결 후
npx expo run:ios -d
```

배포용 Android APK는 EAS 로그인 및 프로젝트 연결 후 아래처럼 생성합니다.

```bash
npx eas build --platform android --profile preview
```

## 개인정보 원칙

- OCR은 기기 내 Google ML Kit으로 수행합니다.
- 카메라 사진은 앱 캐시에 잠시 생성되지만 사진첩이나 앱 데이터베이스에는 저장하지 않습니다.
- 환자 기록은 현재 기기의 AsyncStorage에만 보관됩니다.
- 실제 운영 전에는 앱 잠금, OS 보안 저장소를 이용한 암호화, 보존 기간 및 삭제 정책을 추가해야 합니다.

OCR은 빛 반사, 카드 훼손, 글자 크기와 카드 서식에 따라 오인식할 수 있으므로 인식 결과 확인창을 거쳐야 합니다.
