# 이슈 파티 표시 / Issue party display

월드 모드와 간단 모드는 같은 이슈 활동 상태를 표시합니다. 연결된 자동 개발 실행이 시작되면 PR을 만들기 전에도 이슈 번호 아래에 파티장이 나타납니다. 승인 라벨만 있거나 실행이 대기 또는 건너뛰기 상태인 경우에는 자동 개발 파티장을 표시하지 않습니다.

현재 담당자는 구조화된 GitHub Actions 상태 기록을 우선합니다. 담당자가 비어 있으면 같은 이슈·실행·시도의 상태 댓글이 그 시도 시작 이후에 작성된 경우에만, 진행 목록에서 현재 단계와 일치하는 마지막 명시적 담당자를 사용합니다. 시도 번호가 없는 마커는 첫 실행 시도로만 해석합니다. 이전에 작성된 댓글을 수정하거나 작성 시각을 확인할 수 없는 경우의 진행 목록은 참여 이력에만 사용합니다.

개발에서 리뷰로 넘어가면 개발 AI는 대기하고 리뷰 AI만 활성화됩니다. CI 대기와 실행 종료 시 개발·리뷰 AI는 참여 이력으로만 남습니다. 자동 개발 실행이 진행 중이면 파티장은 CI 대기 중에도 대기 상태로 보이며, 연결된 CI가 실제로 실행 중일 때만 움직입니다. 열린 이슈가 CI를 통과해 병합을 기다리면 ‘CI 성공’으로 표시하고 파티장은 대기 상태로 남습니다.

## English

World and Simple modes show the same issue activity. The party leader appears beneath the issue number when its development workflow starts, even before a pull request exists. An approval label alone, a queued run, or a skipped run does not show the development party leader.

Structured GitHub Actions assignments take precedence. If an assignment is missing, the map uses the last explicit entry for the current phase only if the checkpoint matches the issue, run, and attempt and the comment was created at or after the attempt started. A marker without an attempt only matches the first attempt. Progress from a reused comment or a comment with no known creation time is used only as participation history.

During review, only the reviewer is active and the developer remains visible at rest. While waiting for CI or after the run ends, developers and reviewers are shown only as participants. While the development workflow is in progress, its leader rests while waiting for CI. The leader moves only when the linked CI is running. An open issue that has passed CI and is ready to merge shows CI success, and its leader remains at rest.
