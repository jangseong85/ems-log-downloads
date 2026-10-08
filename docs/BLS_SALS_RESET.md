# BLS/SALS 기록 화면 초기화

2026-10-08 사용자 요청으로 기존 BLS/SALS 화면 전체와 진입 탭을 제거했다.

- `src/SalsPage.tsx`, App의 레거시 SALS 화면·타이머·액션 목록·전용 스타일 제거.
- 메모·다수사상자·설정은 유지한다.
- 기기의 기존 AsyncStorage 기록 및 녹음 파일을 지우는 마이그레이션은 수행하지 않는다.
- 기존 PRD 문서는 설계 참고 자료로 보존한다.
- 삭제 전 소스 백업: `/private/tmp/EMSLog-App-before-sals-removal-20261008.tsx`, `/private/tmp/EMSLog-SalsPage-before-removal-20261008.tsx`.
- 임시 폴더 백업은 영구 보관을 보장하지 않으므로 필요한 경우 별도 보관한다.
- 새 기록 화면은 사용자가 구조를 정한 뒤 구현한다. APK 빌드·배포는 별도 작업이다.
# 후속 구현

2026-10-08: 신규 SALS 타이머 화면을 구현했다. 현재 동작은 `SALS_TIMERS.md`를 기준으로 한다. 이 문서의 삭제 내용은 이전 화면 제거 이력이다.
