---
name: test-release-workflow
description: Test a Screenshot Studio release from intake through branded draft, approval, scheduling, and provider receipt. Use for end-to-end tests, release regression checks, new source types, artifact packs, brand-kit changes, Trigger.dev jobs, or provider integrations.
---

# Test Release Workflow

Read RFC 005, RFC 006, and RFC 007. Test one complete release story, not a set
of disconnected endpoints.

## Canonical scenario

1. Create an organization, a published brand-kit version, and a creator,
   approver, and publisher fixture.
2. Ingest one source through the changed path: manual Markdown, upload, API
   key, repository webhook, or generic signed webhook.
3. Verify source deduplication, tenant R2 storage, audit/outbox records, and
   safe worker payloads.
4. Process the source and create the default artifact pack. Confirm lineage to
   source, asset, brand-kit version, template version, and generation attempt.
5. Confirm the workflow cannot schedule before a human approval of the exact
   artifact revision.
6. Schedule it through a sandbox, local Postiz fixture, or provider test mode.
   Verify the recorded provider receipt and a no-duplicate retry.

## Required negative paths

- Replay the input, cancel the release, reject the artifact, revoke the key,
  remove the publisher, disable the connection, and return a provider timeout.
- Confirm every case stops or reconciles without a second post.
- Confirm an edit or regeneration creates a new revision that needs approval.

## Safety

Never publish to a customer destination during automated tests. Use test
accounts, local fixtures, or a provider sandbox, and delete only test records
through normal product operations.
