# 개발과 배포

[로컬 실행 방법](../README.md#시작하기)에 따라 개발 서버를 시작합니다. Vite와 Vercel은 같은 읽기 전용 API 핸들러를 사용합니다. 실데이터를 조회하는 환경에서는 `api.github.com`에 접근할 수 있어야 합니다. GitHub 조회 코드는 요청을 분기하는 `server/github.ts`와 기능별 `server/github-*.ts`로 나뉩니다.

| 작업                           | 위치                                                      |
| ------------------------------ | --------------------------------------------------------- |
| GitHub 요청과 캐시             | [server/github.ts](../server/github.ts)                   |
| GitHub 기록에서 작업 상태 판정 | [server/model.ts](../server/model.ts)                     |
| API 진입점                     | [api/github.ts](../api/github.ts)                         |
| 앱 진입점과 전체 상태          | [src/main.tsx](../src/main.tsx)                           |
| 왕국 지도                      | [src/kingdom-region.tsx](../src/kingdom-region.tsx)       |
| 상세 팝업                      | [src/detail-dialogs.tsx](../src/detail-dialogs.tsx)       |
| 자동 갱신                      | [src/use-region-refresh.ts](../src/use-region-refresh.ts) |
| SVG 원본과 화면 연결           | [SVG 도감](assets.md)                                     |

## 검증

```bash
npm test
npm run build
npm run format:check
```

## Vercel 배포

GitHub 저장소를 Vercel에 연결하고 Node.js 24 기반 Vite 프로젝트로 배포합니다. 빌드 명령과 출력 경로는 [vercel.json](../vercel.json)에 있습니다. 별도 DB는 필요하지 않습니다.

저장소의 [main 룰셋](../.github/rulesets/main.json)을 적용하면 `main` 대상 PR은 Vercel 프리뷰 검사를 통과해야 머지할 수 있습니다. 작업 및 PR 작성 규칙은 [개발 지침](../AGENTS.md)을 따릅니다.

## 프로덕션 릴리스 기록

기본 브랜치 `dev`의 [릴리스 워크플로](../.github/workflows/production-release.yml)는 Vercel이 Agentopia의 `main` 프로덕션 배포 성공을 통지하면 실행됩니다. 배포한 커밋마다 `prod-<전체 커밋 SHA>` 태그가 남습니다. 같은 커밋을 다시 배포하면 기존 태그를 사용합니다.

GitHub Releases에는 이 워크플로가 발행한 최신 성공 릴리스 하나를 유지합니다. 새 릴리스 발행에 성공한 뒤 이전 자동 릴리스 항목을 삭제하며, 이전 커밋은 Tags에서 확인할 수 있습니다. 프리뷰·실패 이벤트와 수동 릴리스는 정리 대상에서 제외됩니다.

### 배포는 성공했는데 태그가 없을 때

1. GitHub Actions의 **Production release** 실행 목록을 확인합니다. 실행이 없다면 Vercel 프로젝트의 **Settings → Git**에서 `repository_dispatch` 이벤트 전송을 확인합니다. 프로젝트 API에서 `gitProviderOptions.disableRepositoryDispatchEvents` 값이 `false`여야 합니다. GitHub 커밋에 표시되는 Vercel 성공 검사와 이 이벤트는 별도로 전달됩니다.
2. 실행이 있으면 작업의 실행 여부와 로그를 확인합니다. 워크플로는 Vercel 봇이 보낸 이 프로젝트의 `production` 환경, `main` 브랜치 성공 이벤트만 처리합니다. 발행 단계에서 실패한 실행은 원인을 해결한 뒤 다시 실행할 수 있습니다.
3. 이미 누락된 태그를 복구할 때는 Vercel에서 프로덕션 도메인이 연결된 성공 배포의 **전체 Git SHA**를 확인합니다. GitHub의 Tags에서 해당 태그가 없는지 확인한 뒤 그 SHA에 `prod-<전체 SHA>` 태그를 생성합니다. 이 복구는 Git 태그만 만들며, 자동 릴리스 발행 여부는 다음 프로덕션 성공 이벤트의 실행 기록에서 확인합니다.

## 이슈에서 AI 초안 PR 만들기

저장소 쓰기 권한이 있는 사용자가 열린 이슈에 `ai:develop` 라벨을 붙이면 Codex가 변경을 준비하고 Claude가 해당 커밋을 리뷰합니다. 이슈마다 `ai/issue-<번호>-codex` 브랜치와 `dev` 대상 초안 PR 한 개를 사용합니다. 변경 범위는 `src/`, `server/`, `api/`, `docs/`의 허용된 텍스트 형식과 `README.md`입니다.

- PR의 **Test and build**와 Claude 리뷰 결과를 확인한 뒤 사용자가 검토 준비 전환과 머지를 결정합니다. PR CI는 모델 키와 게시 토큰 없이 실행됩니다.
- 이슈의 `ai:develop` 라벨을 유지한 상태에서 **AI development → Run workflow**에 이슈 번호를 입력하면 기존 초안을 이어서 처리합니다. `dev`가 앞서 있으면 PR에 `dev`를 반영한 뒤 실행합니다. 이슈를 닫거나 `ai:stop`을 붙이면 다음 게시 단계에서 실행을 중단합니다.
- Actions에 `ai-development` 환경을 만들고 배포 브랜치를 `dev`로 제한합니다. 환경 시크릿에 `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `AI_AUTOMATION_TOKEN`을, 환경 변수에 `AI_CODEX_MODEL`, `AI_CLAUDE_MODEL`을 설정합니다. 게시 토큰은 Agentopia 저장소의 Contents 및 Pull requests 쓰기 권한을 가진 GitHub App 토큰 또는 fine-grained PAT가 필요합니다. 별도 게시 토큰을 사용해야 PR 이벤트에서 일반 CI가 시작됩니다.
- 첫 실행 전에 Vercel의 프리뷰 브랜치 설정을 확인합니다. Git 연동이 AI 작업 브랜치의 프리뷰를 실행하는 경우 해당 프리뷰에 민감한 환경 변수가 주입되지 않도록 합니다. 프로덕션 릴리스는 `main` 배포 성공 이벤트로 기록합니다.
