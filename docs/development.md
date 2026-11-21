# 개발과 배포

[로컬 실행 방법](../README.md#시작하기)에 따라 개발 서버를 시작합니다. Vite와 Vercel은 같은 읽기 전용 API 핸들러를 사용합니다. 실데이터를 조회하는 환경에서는 `api.github.com`에 접근할 수 있어야 합니다.

| 작업                           | 위치                                    |
| ------------------------------ | --------------------------------------- |
| GitHub 요청과 캐시             | [server/github.ts](../server/github.ts) |
| GitHub 기록에서 작업 상태 판정 | [server/model.ts](../server/model.ts)   |
| API 진입점                     | [api/github.ts](../api/github.ts)       |
| 월드맵과 상세 화면             | [src/main.tsx](../src/main.tsx)         |
| SVG 원본과 화면 연결           | [SVG 도감](assets.md)                   |

## 검증

```bash
npm test
npm run build
npm run format:check
```

## Vercel 배포

GitHub 저장소를 Vercel에 연결하고 Node.js 24 기반 Vite 프로젝트로 배포합니다. 빌드 명령과 출력 경로는 [vercel.json](../vercel.json)에 있습니다. 별도 DB는 필요하지 않습니다.

저장소의 [main 룰셋](../.github/rulesets/main.json)을 적용하면 `main` 대상 PR은 Vercel 프리뷰 검사를 통과해야 머지할 수 있습니다. 작업 및 PR 작성 규칙은 [개발 지침](../AGENTS.md)을 따릅니다.
