#!/usr/bin/env bash
set -euo pipefail

environment="repos/${GITHUB_REPOSITORY}/environments/ai-development"
if ! gh api "$environment" | jq -e '.deployment_branch_policy.custom_branch_policies == true' >/dev/null ||
   ! gh api "$environment/deployment-branch-policies?per_page=100" |
     jq -e '.total_count == 1 and (.branch_policies | length == 1) and
            .branch_policies[0].name == "dev" and .branch_policies[0].type == "branch"' >/dev/null; then
  echo '::error::ai-development 환경을 dev 브랜치로 제한했는지 확인할 수 없습니다. 환경 설정과 Actions 읽기 권한을 확인하세요.'
  exit 1
fi
