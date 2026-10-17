---
name: shots
description: Use when the user wants to turn a code change or release into a Shots launch, draft campaign posts, capture product screenshots, upload launch assets, or check what is waiting for review in their Shots workspace.
---

# Shots

Shots turns a software release into a reviewed launch. The `shots` MCP server
acts in one workspace with the scopes its key or OAuth approval granted.

## Workflow

1. Read before writing: `listReleases`, `listCampaigns`, and `listApprovals`
   show what exists and what is waiting for a person.
2. Describe the release with `createRelease`: a title, why it matters to users
   (`benefitStatement`), and source links such as the pull request or
   changelog. Send an `idempotencyKey` derived from the change (for example
   the merge commit) so a retry never creates a second release.
3. Draft the launch with `createCampaign`: a name, an objective, angles, and
   one post per channel (`x`, `linkedin`, `instagram`, `product_hunt`).
   Keep X posts under 280 characters. Posts start as `DRAFT`.
4. Add visuals: `captureScreenshot` a public page of the product, or upload a
   file with `createAssetUploadUrl`, a `PUT` to the signed URL with the
   declared `Content-Type` and `If-None-Match: *`, then `completeAssetUpload`.
5. Submit with `requestCampaignReview` and tell the user to review in Shots.

## Limits

- No tool approves, schedules, or publishes. Never claim a post is live.
- `deleteAsset` is destructive; confirm with the user first.
- A refusal carries a `code`: `workspace_feature_not_entitled` means the plan
  lacks the feature, `forbidden` usually means the key lacks a scope, and
  `rate_limited` or `workspace_quota_exceeded` carry `retryAfter`.
- Write only what the release supports. Do not invent metrics, customers, or
  pricing; reviewers will reject unsupported claims.
