# 이슈 파티 표시 / Issue party display

월드 모드와 간단 모드는 같은 판정을 적용합니다. 열린 이슈나 PR에 귀속되는 자동 개발 실행이 시작됐거나 종료된 기록, 또는 연결된 CI 기록이 확인되면 파티장을 표시합니다. 자동 개발이 시작되기 전의 대기 기록, 건너뛴 자동 개발 실행, 승인 라벨, Codex·Claude의 리뷰나 커밋만으로는 파티장을 표시하지 않습니다.

현재 담당자는 구조화된 GitHub Actions 상태 기록을 우선합니다. 담당자가 비어 있으면 같은 이슈·실행·시도의 상태 댓글이 그 시도 시작 이후에 작성된 경우에만, 진행 목록에서 현재 단계와 일치하는 마지막 명시적 담당자를 사용합니다. 시도 번호가 없는 마커는 첫 실행 시도로만 해석합니다. 이전에 작성된 댓글을 수정하거나 작성 시각을 확인할 수 없는 경우의 진행 목록은 참여 이력에만 사용합니다.

개발에서 리뷰로 넘어가면 개발 AI는 대기하고 리뷰 AI만 활성화됩니다. CI 대기와 실행 종료 시 개발·리뷰 AI는 참여 이력으로만 남습니다. 파티장은 연결된 PR의 현재 HEAD에서 CI가 실행 중일 때만 움직입니다. CI가 대기 중이거나 종료된 경우, 또는 PR을 만들기 전에 자동 개발이 종료된 경우에도 참여 기록이 있으면 대기 상태로 남습니다. 이전 HEAD의 CI는 참여 이력으로만 표시합니다. 열린 이슈가 CI를 통과해 병합을 기다리면 ‘CI 성공’으로 표시합니다.

## 이슈 팝업의 서브 이슈

월드 모드와 간단 모드의 이슈 팝업은 지도에서 사라진 닫힌 자식도 포함해 GitHub에서 직접 연결한 서브 이슈의 상태와 링크를 보여 줍니다. 전체 목록을 확인했을 때만 완료 집계를 표시하며, 종료 사유가 `completed`인 항목만 완료로 셉니다. 목록이 비어 있다고 확인되면 섹션을 생략합니다. 기존 조회 결과를 우선 사용하며, 목록이 불완전하면 팝업을 열 때 나머지를 조회합니다. 조회가 일부만 성공해도 이미 확인한 링크는 남습니다.

## English

World and Simple modes use the same rules. An open issue or pull request shows a party leader when there is evidence that an associated development workflow started or finished, or that associated CI was recorded. An approval label, an unstarted development run, a skipped development run, or Codex or Claude reviews or commits alone do not show a party leader.

Structured GitHub Actions assignments take precedence. If an assignment is missing, the map uses the last explicit entry for the current phase only if the checkpoint matches the issue, run, and attempt and the comment was created at or after the attempt started. A marker without an attempt only matches the first attempt. Progress from a reused comment or a comment with no known creation time is used only as participation history.

During review, only the reviewer is active and the developer remains visible at rest. While waiting for CI or after the run ends, developers and reviewers are shown only as participants. The leader moves only while CI is running on the linked pull request’s current HEAD. When CI is queued or finished, or when development ends before a pull request exists, the leader remains at rest if participation was recorded. CI for an older HEAD counts only as history. An open issue that has passed CI and is ready to merge shows CI success.

### Sub-issues in the issue dialog

The issue dialog in World and Simple modes shows the status and GitHub link for each directly linked sub-issue, including closed children that no longer appear on the map. The completion count appears only when the whole list is known, and counts only issues closed as `completed`. A confirmed empty list is hidden. The dialog uses existing results first, fetches missing pages on open, and keeps known links visible if a lookup is incomplete.
