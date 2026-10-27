# Epic LIOPT: LinkedIn publishing options

Reconciled against `19390194` and the implementation in this working tree. The October 23 expansion deferral is reopened by this assignment. [Execution](execution.md) distinguishes observed local test results from external provider verification.

## WI-LIOPT-1: Publish first comments without losing the post

**Gap:** Partial at the audited baseline; source evidence and the implemented slice are recorded below.

**Priority:** Reopened expansion. **Size:** M; live provider activation remains separately gated.

**Source:** TF-071. [Source requirements](../changelog-features.md).

**Dependencies:** Published root receipt; existing Temporal optional-action ledger.

**Affected code and current evidence:** `components/write/composer/version-options.tsx`; `lib/write/publication.ts`; `server/internal/temporalpublishing/automation.go`; `server/internal/social/tenantpublishing/automation.go`.

### Implementation gap and disposition

First comments are a receipted optional action after the main LinkedIn post. Preserve that separation through retries, cancellation and UI recovery.

### Acceptance criteria

Save and validate the first comment up to 1,250 characters. Publish the main post once, then comment using its confirmed identity. A failed comment leaves the main post PUBLISHED and shows the failed extra. Replaying a completed action does not create another comment.

### Failure behavior

No comment is sent for a failed or unknown root. A comment timeout remains unknown rather than automatically duplicating the external comment.

### Verification

`server/internal/temporalpublishing/automation_test.go`; `server/internal/social/tenantpublishing/automation_test.go`; `test/write-publication.test.ts`; `test/e2e/write.spec.ts`. Execute the relevant tests and record results in the coverage matrix; listed tests alone do not certify this item.

### Observability and activation

Optional-action receipt, attempt count and separate failure state appear on the draft. Live LinkedIn comment permission remains unverified.

## WI-LIOPT-2: Mention companies and authorized people

**Gap:** Partial at the audited baseline; source evidence and the implemented slice are recorded below.

**Priority:** Reopened expansion. **Size:** M; live provider activation remains separately gated.

**Source:** TF-077, TF-094. [Source requirements](../changelog-features.md).

**Dependencies:** Community Management permission and provider search/resolve availability.

**Affected code and current evidence:** `components/write/composer/social-mention.tsx`; `server/internal/product/social_mentions.go`; `app/api/v1/social-sets/[id]/mentions/route.ts`; `lib/write/normalize-mentions.ts`.

### Implementation gap and disposition

Company and supported person references must retain provider identity through Plate, REST text syntax, serialization and refresh. Agent lookup now rechecks key and set access after the provider returns.

### Acceptance criteria

Resolve only the chosen connected account within the visible set. Preserve @[Company](urn:li:organization:ID) as a company mention and display the label. Search results select stable URNs; arbitrary label text cannot impersonate an identity. Revoke access during lookup and verify the result is refused.

### Failure behavior

Unsupported person/company lookup is explicit. Do not fabricate search results, infer grants or send a mention through an unrelated account.

### Verification

`server/internal/product/social_mentions_test.go`; `server/internal/product/social_set_queue_integration_test.go`; `server/internal/social/tenantpublishing/options_test.go`; `test/e2e/write.spec.ts`. Execute the relevant tests and record results in the coverage matrix; listed tests alone do not certify this item.

### Observability and activation

Lookup authorization and provider errors are observable without logging search text or credentials. Live search needs Community Management app approval.

## WI-LIOPT-3: Publish documents, reposts and pages

**Gap:** Partial at the audited baseline; source evidence and the implemented slice are recorded below.

**Priority:** Reopened expansion. **Size:** M; live provider activation remains separately gated.

**Source:** TF-083, TF-098. [Source requirements](../changelog-features.md).

**Dependencies:** LinkedIn document upload and organization publishing permissions.

**Affected code and current evidence:** `components/write/composer/pdf-carousel.tsx`; `components/write/composer/version-options.tsx`; `server/internal/social/integrations/social/linkedin/linkedin.go`; `server/internal/social/integrations/social/linkedinpage/linkedinpage.go`; `server/internal/product/content_draft_documents.go`.

### Implementation gap and disposition

PDF assets, native LinkedIn repost targets and page accounts use the existing publication model. Avoid presenting a plain URL post as a native repost.

### Acceptance criteria

Upload a workspace PDF, attach its stable asset identity and document title, and retain both after refresh. Resolve a valid LinkedIn post URN and serialize native repost content. Use the actual organization author for a connected page. Reject private/foreign assets and unsupported visibility before enqueueing.

### Failure behavior

Document initialization/upload failures prevent the main publish. Optional first-comment failures remain separate. Missing organization rights require reconnection or app approval.

### Verification

`server/internal/social/integrations/social/linkedin/linkedin_test.go`; `server/internal/social/tenantpublishing/options_test.go`; `server/internal/product/content_draft_write_integration_test.go`; `test/e2e/write.spec.ts`. Execute the relevant tests and record results in the coverage matrix; listed tests alone do not certify this item.

### Observability and activation

Provider upload/publication receipts establish local contract completion; PDF rendering and repost/page outcomes need live authorized verification.
