#!/usr/bin/env bash
# Run with a gh login/token that has repository Administration write access.
set -euo pipefail
cd "$(dirname "$0")/../.."
repository="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
gh api --method PATCH "repos/$repository" -f default_branch=develop >/dev/null
for branch in develop main; do
  ruleset_name="$branch branch flow"
  rule_id="$(gh api "repos/$repository/rulesets" --paginate --jq ".[] | select(.name == \"$ruleset_name\") | .id")"
  if [ -n "$rule_id" ]; then
    gh api --method PUT "repos/$repository/rulesets/$rule_id" --input ".github/rulesets/$branch.json" >/dev/null
  else
    gh api --method POST "repos/$repository/rulesets" --input ".github/rulesets/$branch.json" >/dev/null
  fi
done
printf '%s\n' 'Default branch: develop. PR/check rules configured for develop and main.'
