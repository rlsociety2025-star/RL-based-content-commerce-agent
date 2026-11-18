# Claude 연결 전환 (2026-11-18)

배포 설정은 `LLM_PROVIDER=claude`, `CLAUDE_MODEL=claude-haiku-4-5-20251001`을 선택합니다. 기존 Gemma 코드는 `LLM_PROVIDER=gemma`로 명시할 때만 사용할 수 있습니다. 다른 제공자로 자동 fallback하지 않습니다.

0. 기존 DB에는 `db/002_claude_model.sql`을 적용하고 `db/verify.sql`의 `cc_runs_model_check` 결과를 먼저 확인합니다. 신규 DB는 수정된 `001_real_integrations.sql`을 사용합니다. 허용 모델은 기존 `gemma-%`와 정확한 `claude-haiku-4-5-20251001`뿐입니다. Worker 모델을 바꾸면 DB 허용 목록도 생성 호출 전에 확인해야 합니다.
   - 생성 성공 뒤 DB 저장 실패가 나면 **생성 버튼을 다시 누르지 마세요**. 비용이 이미 발생했을 수 있습니다. 현재 버전은 미저장 응답을 복구·재저장하는 기능이 없으며, 같은 request_id도 저장된 기록이 없으면 재호출을 막지 못합니다.
1. 채팅에 노출되지 않은 새 키를 Cloudflare 런타임 Secret `ANTHROPIC_API_KEY`에 직접 저장합니다. 채팅·GitHub·브라우저 코드에 키를 넣지 마세요.
2. Qdrant URL/키와 임베딩 바인딩은 별도로 필요합니다. 기존 컬렉션은 삭제하지 않습니다.
3. `실제 연결 점검`의 모델 GET 조회는 생성 요청이 아닙니다. 모델 접근 확인과 실제 생성/과금 확인은 구분합니다.
4. 실제 샘플 테스트에 동의하기 전 `AI_CALLS_ENABLED`는 false/미설정으로 유지합니다. 생성 시 주제·선택 상품·검색 근거가 Anthropic에 전송되고, 색인/검색 텍스트는 Cloudflare에 전달됩니다. 외부 전송 가능한 자료만 사용하세요.
5. 기존 사용자별 5회/60초 제한과 출력 3072 토큰 상한을 유지합니다. 이는 월 지출 상한이 아닙니다. Anthropic Console에서 별도 지출 한도를 설정하세요. 자동 재시도·자동 fallback은 없습니다.

구문·회귀 검사는 `npm run check`. 실제 키·모델/클러스터·사용자 세션으로의 종단간 검증은 별도입니다. API: https://platform.claude.com/docs/en/api/messages/create , 모델 조회: https://platform.claude.com/docs/en/api/models/retrieve

저장한 초안은 **실행 기록 → 저장 결과 열기**에서 유료 재생성 없이 다시 볼 수 있습니다. 동일 사용자 세션 갱신은 표시 중인 초안을 지우지 않으며, 로그아웃·계정 전환 시에는 즉시 화면을 비웁니다.

---
아래는 기존 Gemma 배포 참고 문서입니다. 위 Claude 설정이 우선합니다.

# 콘텐츠커머스 실연동 워크벤치 · Cloudflare Workers

기존 `rlsociety2025-star/RL-based-content-commerce-agent` 저장소 안의 독립 앱입니다. `gyedong-seasons`와 D1 투표 데이터는 수정하지 않습니다. 기존 프로젝트 대시보드는 배포 시 `/project/`에 복사하며 원본을 변경하지 않습니다.

## 이번 범위와 현재 상태

실행 코드: 자료 등록·사람 검토 → Workers AI **bge-m3** → **Qdrant** 검색 → Google Gemini API의 **Gemma** 생성 → **Supabase** 영구 저장·재조회·검토 기록.

- 기본 모델: `gemma-4-26b-a4b-it` (Google 공식 호스팅 목록 확인). 모델 호출 성공 여부는 새 키 설정 후 확인해야 합니다.
- 기존 HTML 모의 학습 데모는 별개입니다. 이번 앱은 네이버 게시·매출 수집 또는 실제 보상 RL 학습을 이미 완료했다고 표시하지 않습니다.
- 입력 자료·상품·실행 결과는 초기에는 비어 있습니다. 가상 상품을 실제 상품으로 자동 등록하지 않습니다.
- 연결 실패를 템플릿/키워드 검색/로컬 저장 성공으로 대체하지 않습니다.
- 외부 응답을 대체한 Node 테스트 **26개**, 모의 API/SDK를 사용한 브라우저 검사 **14개**를 통과했습니다. 브라우저는 제작 환경의 URL 탐색 제한 때문에 DOM과 코드를 주입하여 검사했습니다. 실계정 종단간 연결 검증은 미완료입니다.
- 2026-11-17 작업 시 Supabase는 `ACTIVE_HEALTHY`를 반환했지만 SQL 실행은 2회 타임아웃했습니다. **아래 SQL은 아직 적용하지 않았습니다.**
- Cloudflare 새 Worker 생성·Git 연동을 자동 실행할 수 있는 인증 연결이 없어 **현재 공개 배포 완료 상태가 아닙니다.**

## 1. Supabase 추가 테이블

대상 프로젝트: `hfqqqetcjbkptipqhskx` (기존 콘텐츠커머스 프로젝트).

SQL Editor에서 `db/001_real_integrations.sql`을 **한 번만** 실행한 뒤 `db/verify.sql`을 실행합니다. SQL은 기존 대시보드 테이블과 RLS를 수정하지 않고 `cc_sources`, `cc_products`, `cc_runs`, `cc_reviews`만 추가합니다. `dashboard_access`에 등록되어 `active=true`인 팀원만 사용할 수 있습니다. 회원가입은 자동 승인이 아닙니다.

출처 본문은 불변입니다. 변경이 필요하면 새 자료를 등록하고 이전 자료를 검색 제외합니다. 생성된 초안을 사람이 별도로 검토·등록하기 전에는 검색 근거로 승격하지 않습니다. `cc_runs.reward`는 항상 NULL입니다. 실적이 없는 것을 0으로 가장하거나 시뮬레이션 보상과 혼합하지 않습니다.

## 2. 계동모임과 같은 Git 자동 배포

Cloudflare → Workers & Pages → 새 애플리케이션/Worker → GitHub 저장소 가져오기에서 다음 설정을 사용합니다.

| 설정 | 값 |
|---|---|
| 저장소 | `rlsociety2025-star/RL-based-content-commerce-agent` |
| Worker 이름 | `rl-content-commerce` |
| 운영 브랜치 | `main` |
| Root directory | `commerce` |
| Build command | `npm run check && npm run build` |
| Deploy command | `npm run deploy` |
| NODE_VERSION | `22` |

배포 CLI는 계동모임 저장소와 같은 `wrangler@4.92.0`으로 고정했습니다. 런타임은 순수 ES module + fetch/Web Crypto이고 추가 npm 런타임 패키지가 없습니다. 기존 저장소의 `vendor/supabase.js`를 브라우저 인증에 재사용합니다.

Workers AI 바인딩(`AI`)과 호출 제한 바인딩(`AI_RATE_LIMITER`)은 wrangler.json에 포함했습니다. D1은 생성하지 않습니다. Git 연결 후 main의 새 변경이 Cloudflare 빌드·배포를 유발합니다. 최초 생성 전에는 배포 주소를 확정해 안내하지 않습니다.

## 3. Worker의 Settings → Variables and Secrets

다음 4개를 **런타임 Secret**으로 등록합니다. GitHub 코드/HTML/채팅에 붙이지 마세요. 빌드 환경변수만 추가하는 것이 아닙니다.

| Secret 이름 | 내용 |
|---|---|
| `GEMINI_API_KEY` | 교체한 새 Google AI Studio 키. 이전에 채팅에 올린 값은 재사용하지 않음 |
| `QDRANT_URL` | 사용자의 실제 Cloud 클러스터 기본 https 주소. URL도 Secret으로 보관하여 Git 배포 시 유지 |
| `QDRANT_API_KEY` | 별도 컬렉션 생성·색인·검색에 필요한 Qdrant 권한 |
| `AI_CALLS_ENABLED` | 처음에는 미설정(호출 차단). 준비 완료 후 `true` |

Supabase URL과 브라우저용 publishable key는 이미 설정했습니다. Secret/service_role 키는 필요하지 않습니다. Qdrant는 **새 `content_commerce_bge_m3_v1` 컬렉션만** 사용하며 기존 다른 컬렉션을 삭제하거나 재구성하지 않습니다. 1024차원 Cosine과 다르면 중단합니다.

`AI_CALLS_ENABLED`를 Secret으로 두므로 다음 Git 배포가 값 `false`로 덮어쓰지 않습니다. 모델/컬렉션 등 비밀이 아닌 고정 설정만 `wrangler.json`에서 변경합니다.

## 4. 로그인 및 첫 실제 실행

1. 배포된 사이트 주소를 Supabase Authentication → URL Configuration의 Site URL/Redirect URLs에 등록합니다.
2. 앱에서 팀 계정을 만들고 이메일 인증을 완료합니다. 운영자는 기존 `sql/approve_member.sql` 방식으로 팀원을 승인합니다. 비밀번호는 공유하지 않습니다. 승인 후 화면의 **승인 상태 확인**을 누릅니다.
3. 앱에서 **실제 연결 점검**을 누릅니다. ‘바인딩 설정됨’은 임베딩 API를 실행했다는 뜻이 아닙니다. 빈 Qdrant 컬렉션은 첫 색인 전까지 ‘없음’으로 나오는 것이 정상입니다.
4. 외부 서비스로 전송해도 되는 근거 노트 1개 이상과 실제 상품 1개를 등록합니다. 본인이나 팀이 확보한 자료만 사용합니다.
5. 노트를 읽고 **검토 완료 → Qdrant 색인**을 실행합니다. bge-m3는 임베딩을 실제로 생성합니다.
6. 주제와 상품을 선택하고 **근거만 검색** 후 **Gemma 생성 · DB 저장**을 실행합니다.
7. **실행 기록 → 기록 다시 읽기**에서 동일 run ID와 초안이 서버에서 다시 조회되는지 확인합니다.
8. 승인/반려 기록은 남기되 실제 게시와 매출로 간주하지 않습니다. 같은 요청의 동시 실행은 외부 LLM 중복 비용이 생길 수 있으므로 버튼을 반복 호출하지 않습니다.

자료 본문은 임베딩을 위해 Cloudflare Workers AI로, 검색 근거와 상품 설명은 생성 시 Google로 전달됩니다. Qdrant에는 벡터와 출처 ID/해시/문단 번호를 저장합니다. 앱은 검색 후 Supabase의 최신 verified 상태와 해시를 다시 확인합니다.

## 비용·보안 경계

- 키가 없거나 AI_CALLS_ENABLED가 true가 아니면 비용 발생 호출을 막습니다. AI 호출은 승인된 사용자별 Cloudflare 지역별 제한을 적용합니다. **이 제한은 계정 전체 과금 상한이 아닙니다.** 공급자에서 예산/할당량도 설정하세요.
- 모든 데이터 API는 서버에서 Auth 사용자 확인과 팀원 승인 확인 후 실행합니다. Supabase에도 RLS와 열별 GRANT를 적용합니다.
- 서비스 역할 키로 RLS를 우회하지 않습니다. 웹 클라이언트는 승인 등록/레코드 삭제/원본 수정 권한이 없습니다.
- 외부 오류 본문·비밀키·원본 프롬프트를 서버 로그에 출력하지 않습니다.
- Gemma 출력은 JSON 파싱·허용 상품 ID/근거 ID 검사 후 저장하고, 화면에서는 HTML로 실행하지 않고 텍스트로 표시합니다. 이 검사가 문장 내용의 사실성까지 보증하지는 않습니다.
- SQL은 운영 DB에 아직 적용하지 않았으므로 RLS의 실제 DB 동작 테스트는 적용 후 수행해야 합니다. Node 테스트의 mock 통과를 실제 서비스 성공으로 표현하지 마세요.
- 승인된 팀원은 REST API로도 자신의 기록을 추가할 수 있습니다. 저장된 기록은 신뢰된 팀 운영용이며, 독립적인 외부 실행 증명이나 위변조 불가능한 감사 증거가 아닙니다.

## 로컬 검증

```sh
cd commerce
npm run check
npm run build
cp .dev.vars.example .dev.vars
# 비밀키는 로컬 .dev.vars에 직접 입력. Git에는 제외됨.
npm run dev
```

모의 네트워크 테스트만으로 충분하지 않습니다. 배포 후 승인 사용자/미승인 사용자/로그아웃 상태를 각각 확인하고, 실제 Qdrant 색인·Gemma 생성·Supabase 재조회를 수행해야 합니다. `.github/workflows/commerce-check.yml`은 코드 검사·빌드·Wrangler dry-run만 실행하며 실제 배포를 하지 않습니다.

## 확인한 공식 문서

- https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api
- https://developers.cloudflare.com/workers-ai/models/bge-m3/
- https://developers.cloudflare.com/workers/static-assets/binding/
- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- https://api.qdrant.tech/api-reference/search/query-points
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically
