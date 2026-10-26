# 우리집 가계부

카드 승인 문자·카드사 앱 알림·카카오톡 알림톡을 두 사람의 안드로이드 휴대폰(MacroDroid)에서 받아
자동으로 기록하는 부부 공유 가계부입니다.

- `web/` 휴대폰 홈 화면에 설치해 쓰는 웹앱 (GitHub Pages로 배포)
- `supabase/functions/ingest` 휴대폰이 알림을 보내는 수집 주소
- `supabase/functions/_shared` 문자 해석, 중복 판정, 자동 분류 (웹앱과 같이 씀)
- `supabase/migrations` 데이터베이스 구조와 접근 규칙

## 테스트

```
npm test
```

## 현재 배포

- Supabase 프로젝트: `qcvhgvgmfjsyrkbddgmk` (웹앱 기본값으로 워크플로에 들어 있음, anon 키는 공개용)
- 웹앱: https://assajudong-cell.github.io/household-ledger/
- `ingest` 함수는 JWT 검사를 켠 상태라 휴대폰에서 보낼 때 `Authorization: Bearer <anon 키>` 헤더가 필요합니다 (앱 설정 화면에서 복사).

## 배포에 필요한 설정 (GitHub 저장소 > Settings > Secrets and variables > Actions)

| 종류 | 이름 | 값 |
|---|---|---|
| Variable | `SUPABASE_PROJECT_REF` | Supabase 프로젝트 주소의 `https://<여기>.supabase.co` 부분 |
| Variable | `SUPABASE_ANON_KEY` | Supabase > Project Settings > API 의 anon public 키 |
| Secret | `SUPABASE_ACCESS_TOKEN` | supabase.com/dashboard/account/tokens 에서 발급 |
| Secret | `SUPABASE_DB_PASSWORD` | 프로젝트 만들 때 정한 데이터베이스 비밀번호 |

GitHub Pages는 Settings > Pages > Source 를 **GitHub Actions** 로 지정합니다.
Supabase > Authentication > URL Configuration 의 Site URL 에 Pages 주소를 넣어야 로그인 링크가 앱으로 돌아옵니다.
