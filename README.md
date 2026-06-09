# AI 학교 시간표 운영 콘솔

학교 시간표 자동배정 웹앱입니다. 운영 방향은 하이브리드입니다.

- 자동배정, 분석, 수동수정 계산: 사용자 PC의 브라우저 Web Worker
- 로그인, 시나리오 저장, 선택적 파일 저장: Next.js API
- AI 호출: 브라우저 직접 호출
- API 키: 서버, DB, 로그, Blob에 저장하지 않음

이 구조에서는 Vercel 서버 함수가 무거운 시간표 계산을 하지 않습니다. 사용자가 1명이어도 100명이어도 각자의 PC에서 계산하므로 Vercel 함수 실행시간과 Redis 작업 큐 비용을 피할 수 있습니다.

## 실행

```powershell
npm install
npm run dev
```

로컬 기본 주소는 `http://127.0.0.1:8765`입니다.

관리자 비밀번호 해시는 다음 명령으로 만들 수 있습니다.

```powershell
npm run hash:admin -- "관리자비밀번호"
```

`.env.local` 예시:

```env
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD_HASH=pbkdf2$...
AUTH_SECRET=충분히긴랜덤문자열

# 선택 저장 기능을 쓸 때만 필요
DATABASE_URL=...
BLOB_READ_WRITE_TOKEN=...
```

## Web Worker 자동배정

브라우저에서 엑셀을 읽고 검증한 뒤, 정규화된 자료를 `src/workers/solver.worker.ts`로 전달합니다.

Worker 메시지:

- `init`: 정규화 자료와 배정 옵션 전달
- `start`, `continue`: chunk 단위 탐색
- `acceptBest`: 현재 최선안 확정
- `stop`: 탐색 중지
- `movePreview`, `moveApply`: 수동수정 미리보기와 승인 적용

진행 화면은 탐색 회차, 후보 수, 미배정, hard 오류, 연강, 식사부족, 안배부족, 마지막 개선 시각을 Worker 메시지로 표시합니다.

## AI 429 대응

AI API는 서버 프록시를 거치지 않고 브라우저에서 직접 호출합니다.

- Gemini: `maxConcurrent=1`, `minIntervalMs=6000`, `maxRetries=3`
- OpenAI/Custom: `maxConcurrent=2`, `minIntervalMs=1500`, `maxRetries=3`
- 429 응답은 `Retry-After` 헤더를 우선 사용하고, 없으면 `10s -> 20s -> 40s` backoff를 적용합니다.
- 자동배정 반복 탐색 중에는 원격 AI를 계속 호출하지 않습니다.
- AI는 자연어 제약 구조화, 미배정 원인 요약, 채팅 변경안 제안에만 사용합니다.

Gemini 429가 계속 뜨면 모델을 flash/lite 계열로 바꾸거나 Google Cloud Console에서 Generative Language API 할당량을 확인하세요.

## API

유지되는 가벼운 API:

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/session`
- `GET /api/templates/timetable-input`
- `POST /api/scenarios`
- `GET /api/scenarios`
- 선택적 저장/로그 API

비활성화된 서버 계산/AI 프록시:

- `/api/solve/jobs*`
- `/api/ai/validate-key`
- `/api/ai/chat`

위 경로는 410 응답을 반환합니다. 자동배정과 AI 채팅은 브라우저 코드에서 처리됩니다.

## 검증

```powershell
npm run typecheck
npm run build
```

운영 계산과 Vercel 배포 경로는 TypeScript Web Worker입니다. Python legacy 파일은 Vercel의 Python 런타임 오감지를 막기 위해 배포 브랜치에서 제거했습니다.
