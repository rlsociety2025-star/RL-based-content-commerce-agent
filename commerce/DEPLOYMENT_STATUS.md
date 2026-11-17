# 실운영 연결 상태 — 2026-11-17

이 문서는 이전 README의 ‘SQL 미적용’ 안내보다 최신입니다. 사이트와 외부 AI 연결이 완료됐다는 뜻은 아닙니다.

## 실제 완료

- 기존 Supabase 프로젝트 `hfqqqetcjbkptipqhskx`에 `add_content_commerce_live_integrations`, `add_private_naver_pilot_records` 마이그레이션을 적용했습니다.
- 새 테이블: `cc_sources`, `cc_products`, `cc_runs`, `cc_reviews`, `cc_naver_posts`, `cc_naver_reports`.
- 6개 테이블 모두 RLS 활성화. 네이버 게시/판매 파일은 승인 사용자 본인 행만 접근합니다. 기존 WBS 및 cocoa_v1 테이블은 변경하지 않았습니다.
- 실제 DB 트랜잭션으로 자료 등록·검토·조회, 상품/생성/검토/게시/실적 저장·재조회, 원본 수정 차단, 삭제 차단, 자기 승인 차단, 승인 회수 후 조회 차단을 확인했습니다. 이 검사는 SQL 역할 전환 방식이며 브라우저 로그인 검사는 아닙니다.
- 시험 쓰기와 시험용 승인 변경은 전부 롤백했습니다. 6개 테이블의 기록은 0건이며 실제 콘텐츠나 실적이 들어온 것으로 표시하지 않습니다.
- 공개 사용자(anon) 읽기 권한 없음 확인. 정식 승인 팀원은 아직 0명입니다.
- 로컬 네이버 확장 패키지의 코드 검사 56개 및 빌드를 다시 실행해 성공했습니다. 외부 공급자 응답을 대체한 테스트이며 실제 LLM/Qdrant 성공과는 다릅니다.

**기존 `001_real_integrations.sql` 및 `002_naver_pilot.sql`을 다시 실행하지 마세요.** 해당 테이블은 이미 설치했습니다.

## 미완료 및 필요 입력

- Cloudflare 계정에 새 `rl-content-commerce` Worker 생성/저장소 연결. 현재 이 세션에는 해당 계정을 조작할 커넥터나 CLI 인증이 없습니다.
- `GEMINI_API_KEY`(교체한 새 키), `QDRANT_URL`, `QDRANT_API_KEY`를 Cloudflare runtime Secrets에 설정. 값은 채팅/공개 저장소에 올리지 않습니다.
- 설정 확인 후 `AI_CALLS_ENABLED=true`를 등록합니다. 원격 AI 호출은 비용/할당량이 발생할 수 있으며, 이 변경을 인증 없이 자동으로 대체하지 않습니다.
- 첫 로그인 계정의 본인 확인 후 팀원 승인. 가입자가 자동으로 관리자가 되도록 변경하지 않았습니다.
- 실제 근거 노트 및 본인 제휴 상품 링크 등록.
- 네이버 확장 패키지는 운영 코드에 아직 업로드하지 않았습니다. 현재 GitHub의 commerce 앱은 실제 자료 검색·생성·저장 경로까지의 버전입니다.
- 실제 판매 결과를 RL 보상으로 연결하고 상태·실행·다음 상태를 확인하는 개발/검증은 남아 있습니다. 가상 성과를 실적처럼 사용하지 않습니다.

## 배포 입력값

- GitHub repo: `rlsociety2025-star/RL-based-content-commerce-agent`
- Worker: `rl-content-commerce` (기존 계동모임 Worker 수정 아님)
- Root directory: `commerce`
- Branch: `main`
- Build: `npm run check && npm run build`
- Deploy: `npm run deploy`
- Node: `22`

## 실제 작동 확인 기준

공개 URL 응답, 실제 팀 로그인/승인, 실제 자료 색인·Qdrant 검색, 실제 Gemma 후보 생성, Supabase 저장·다시 읽기, 승인 초안으로 사람이 실제 네이버 게시 후 기록, 공식 판매 자료 반입을 각각 검증합니다. 실적과 실제 행동의 귀속을 확인한 뒤에만 보상/정책 업데이트까지 검증합니다. 코드 검사나 dry-run만으로 전체 작동 완료라고 보고하지 않습니다.

## 보안 점검

Supabase security advisor의 남은 경고: 유출된 비밀번호 차단(Leaked Password Protection)이 비활성 상태입니다. 새 cc_* 테이블에서 RLS 누락 경고는 반환되지 않았습니다.
공식 설정 안내: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
