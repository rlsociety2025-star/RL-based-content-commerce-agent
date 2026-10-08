# RL 기반 콘텐츠 커머스 최적화 에이전트

어떤 글에 어떤 상품을 어떤 시간에 붙여야 더 잘 팔리는지를 AI가 학습하는 서비스.

6명이 2명씩 3개 셀로 협업하는 대학원 세미나 프로젝트입니다. 초기에는 정적 기준모델과 Contextual Bandit을 비교하고, 순차적 의사결정이 필요한 경우 강화학습의 추가 가치를 검증합니다.

## 대시보드 현재 상태 — 2026-10-08

**기존 디자인을 보존한 공용 대시보드 코드와 Supabase 승인 기반 접근 제어를 준비했습니다. GitHub Pages의 최초 활성화는 저장소 소유자의 설정이 필요합니다.**

실제 자동 실행 결과:
- 기존 HTML/CSS 복원 및 업로드: 성공
- Supabase SDK 고정 버전 포함: 성공
- JavaScript 문법 검사, SDK 파일 무결성 검사, 정적 배포 번들 생성: 성공
- GitHub Pages 최초 활성화: `Resource not accessible by integration`으로 차단
- 웹사이트 공개 배포: 아직 완료되지 않음

배포 작업 기록: https://github.com/rlsociety2025-star/RL-based-content-commerce-agent/actions/runs/37765403266

### 소유자가 한 번 설정할 항목

1. 저장소 **Settings → Pages → Build and deployment → Source**에서 **GitHub Actions**를 선택합니다.
2. **Actions → Deploy team dashboard → Run workflow → main → Run workflow**로 실행합니다.
3. 배포 작업이 성공한 뒤 Pages 화면의 사이트 주소를 확인합니다.

배포 성공 후 사용할 주소:
`https://rlsociety2025-star.github.io/RL-based-content-commerce-agent/`

## 처음 로그인하는 방법

Supabase 관리 서비스 가입 계정과 **우리 대시보드의 로그인 계정은 별개**입니다.

1. 대시보드에서 **로그인 → 계정 만들기**로 이메일과 비밀번호(8자 이상)를 등록합니다.
2. 인증 메일을 받은 경우 이메일 인증을 완료합니다.
3. 운영자에게 **가입한 이메일**을 알려 팀원 승인을 요청합니다. 비밀번호를 보내지 않습니다.
4. 운영자가 승인한 뒤 **승인 상태 다시 확인**을 누르거나 다시 로그인합니다.

**계정을 만들었다는 이유만으로 팀 공용 데이터에 접근할 수는 없습니다.** 승인되지 않은 사용자에게는 공개된 프로젝트 설명과 초기 계획만 보입니다.

### Supabase 관리자의 설정

**Authentication → URL Configuration**에서 다음 사이트 주소를 **Site URL**과 허용된 **Redirect URLs**에 등록하세요.

`https://rlsociety2025-star.github.io/RL-based-content-commerce-agent/`

이 Auth 설정은 아직 자동 변경하지 않았습니다. 인증 링크가 localhost로 이동한다면 설정을 확인하세요. 이메일 인증이 완료됐다면 원래 대시보드로 돌아와 로그인할 수 있습니다.

팀원 승인은 [sql/approve_member.sql](sql/approve_member.sql)의 이메일을 실제 인증된 팀원의 이메일로 바꾼 뒤 **운영자만 Supabase SQL Editor에서 실행**합니다. 공개 클라이언트에는 승인 등록 권한이 없습니다.

## 공용 편집 기능

- Overview / 3-Pair Team / WBS와 기존 상세 일정·간트차트 유지
- 승인된 팀원만 담당자 A~F 이름, 체크리스트, WBS 상태와 진행률 편집
- 수정 사항은 Supabase DB에 저장하고 Realtime으로 알림을 받아 재조회
- 실시간 연결 실패 시 상태 표시 및 30초 간격 재조회
- 동시 수정 충돌은 `updated_at` 비교로 감지하고 덮어쓰기 대신 재조회
- 로그아웃·권한 회수·인터넷 연결 중단 시 편집 잠금
- 브라우저의 기존 공용 데이터 캐시는 제거하고, 공용 레코드는 localStorage에 저장하지 않음
- 현재 화면의 읽기 전용 HTML 백업, 전체 탭 인쇄, 전체 화면 지원

## DB 보안

`dashboard_access`, `team_members`, `checklist_items`, `wbs_tasks`, `milestones`, `activity_log`에 RLS를 적용했습니다.

- 공용 데이터는 `dashboard_access.active=true`인 사용자만 조회할 수 있습니다.
- 이름·체크·상태·진행률 등 허용된 열만 수정할 수 있습니다.
- 사용자 자신의 승인 등록, 레코드 삭제, 다른 열 수정은 허용하지 않습니다.
- 변경 이력은 클라이언트가 아니라 DB 트리거가 생성합니다.
- 브라우저 코드에는 publishable key만 포함되며, secret/service_role key나 DB 비밀번호는 없습니다.

**이전에 배포된 `authenticated using (true)` 정책의 SQL은 실행하지 마세요.** 현재 DB는 멤버십 승인 기반 정책으로 구성돼 있습니다.

## 검증 범위

- 실제 Supabase DB에서 승인 전/후/철회 권한, 허용된 열 변경, 감사 로그, 삭제 및 자기 승인 차단을 트랜잭션 테스트했습니다. 테스트 레코드는 모두 롤백했습니다.
- 모의 Supabase SDK를 사용한 브라우저 기능 검사 13개를 통과했고 JavaScript 페이지 오류는 없었습니다.
- 실제 팀원이 아직 가입·승인되지 않았으므로 **실제 사용자 두 명 사이의 라이브 동기화 및 이메일 전달은 아직 검증하지 않았습니다.**

## 공개 범위

**이 저장소와 정적 HTML의 프로젝트 설명·초기 일정은 공개됩니다.** 승인 정책은 Supabase에 저장된 실제 팀 공용 데이터에 적용됩니다. 프로젝트 설명 자체까지 비공개로 하려면 별도의 비공개 호스팅·접근 제어가 필요합니다.

현재 대시보드는 프로젝트 관리용입니다. 네이버 데이터 수집, LLM 콘텐츠 생성, 상품 판매 기능을 이미 구현한 실제 서비스 데모는 아닙니다. 기존 KPI 수치는 프로젝트 목표이며 실측 성과가 아닙니다.

## 주요 일정과 셀 구성

| 목표 | 기한 |
| --- | --- |
| 제안서 완성 | 2026-11-30 |
| End-to-End 통합 MVP | 2027-01-20 |
| 최종 데모 | 2027-02-28 |

| 셀 | 담당 영역 |
| --- | --- |
| Cell 1 — Sense & Memory | 데이터 수집, 정제, 지식·메모리 구조 |
| Cell 2 — Generate & Match | 생성형 LLM 콘텐츠, 상품 후보·링크 매칭 |
| Cell 3 — Learn & Optimize | Bandit/RL, 성과 로그, 플랫폼 통합 |

## 소스

- `index.html` — 기존 레이아웃과 승인 기반 로그인 화면
- `dashboard.css` — 반응형 디자인
- `dashboard.js` — 인증·승인 확인·DB 저장·실시간 동기화
- `vendor/supabase.js` — Supabase JS SDK 2.117.2, MIT 라이선스 포함
- `.github/workflows/deploy-pages.yml` — Pages 자동 배포
- `sql/approve_member.sql` — 운영자용 팀원 승인 템플릿

로컬 개발은 저장소 루트에서 `python -m http.server 8000`을 실행한 뒤 `http://localhost:8000`을 여세요. 실제 로그인·공용 데이터 사용에는 인터넷이 필요합니다.
