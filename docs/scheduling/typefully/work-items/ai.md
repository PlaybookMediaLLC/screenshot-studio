# Epic AI: AI-assisted writing

Reopened by the 2026-10-24 assignment. AI remains a paid, workspace-metered editing tool. See [execution evidence](execution.md) and [coverage](coverage.md); provider fixtures do not establish live output quality.

## WI-AI-1: Continue, critique and prompt writing

**Source:** TF-026, TF-030, TF-046, TF-055, TF-056, TF-059, TF-093 ([requirements](../changelog-features.md#9-ai)).
**Gap:** Partial: the existing assistant lacked the full original prompt library and continuation entry points.
**Priority:** Reopened expansion. **Size:** M.
**Depends on:** Existing model registry, paid AI credits, draft edit permission.

### Problem and scope
Writers need usable starting points and feedback without replacing their work. Include six original exercises with examples, eight assistant starters, continuation and emoji refinements. Preserve the existing chat, explicit insertion and undo. Neither choosing a prompt nor receiving an answer schedules content.

### Changes and evidence
- `components/write/composer/assistant.tsx`, `lib/write/prompt-library.ts`: examples populate an editable instruction; sending is a separate action.
- `lib/write/refine-actions.ts`, `lib/write/refine.ts`: continuation preserves the source text; refinements validate the destination's character count before returning.
- `components/write/composer/WriteComposer.tsx`: empty-draft prompt entry and existing explicit insertion.
- `lib/api/contracts/write-ai.ts`: bounded assistant/refinement inputs; `lib/ai/models/registry.ts` supplies the existing metering and telemetry. No schema migration.

### Acceptance criteria
1. Selecting an exercise changes only the instruction field.
2. An author can review, edit, insert, undo and persist generated writing.
3. A disabled AI policy, depleted balance or inaccessible workspace refuses generation.
4. A malformed or over-limit refinement never replaces the source.

### Failure behavior
Restore the submitted instruction after a failed assistant request. Keep the current document and successful prior turns. A provider outage never becomes a publishing command.

### Verification and observability
`test/e2e/typefully-ai.spec.ts` exercises prompt selection, explicit insertion and refresh with the scripted provider. Existing refinement/model/meter tests cover bounded responses and charging. Inspect `ai.model.generate`/`.failed` by role, model, duration and usage; prompt bodies are not logged. Live prose quality remains unverified.

## WI-AI-2: Apply saved voice and preferences

**Source:** TF-070, TF-093. **Gap:** Verify existing implementation, not a second preference system. [Source requirements](../changelog-features.md).
**Priority:** Reopened. **Size:** S. **Depends on:** Social-set settings and workspace brand profile.

### Problem and scope
All writers in a brand need consistent tone, prohibited terms and examples. Workspace defaults are refined by set overrides and the current instruction. A member may use the guide; only authorized managers change it.

### Changes and evidence
`server/internal/product/writing_assistant.go` merges the authorized context. `lib/write/refine.ts:voiceInstructions` fences examples as reference data. `components/write/composer/assistant.tsx:AssistantSetup` links the existing Writing Assistant settings. Reuse their contracts and persistence; no new model or user-profile store.

### Acceptance criteria
1. Saved samples, terminology, tone and formatting survive reload and reach both assistant and refinement calls.
2. Prohibited phrases survive set overrides.
3. A private/foreign set cannot supply another writer's context.
4. A caller cannot change shared settings through an assistant instruction.

### Failure behavior
An unavailable context must not silently substitute another workspace's guide. Preserve saved settings after validation or authorization failure.

### Verification and observability
Run writing-context Go integration tests and the existing settings browser suite; record their executed results separately from WI-AI-1. Settings audit records identify the actual editor. Context contents remain absent from model logs. `test/e2e/typefully-ai.spec.ts` now passes saved tone, prohibited terms, terminology and writing sample; assistant configuration and generation; refresh; inaccessible supplied draft refusal on transcription/assistant/refinement; and disabling AI, reloading and rejecting transcription. Page-access serialization was repaired so the saved AI-off value is not lost by Settings.

## WI-AI-3: Review a voice-memo transcript before drafting

**Source:** TF-093. **Gap:** Missing audio input; implemented local provider boundary. [Source requirements](../changelog-features.md).
**Priority:** Reopened. **Size:** M. **Depends on:** Configured audio-capable model and AI credits.

### Problem and scope
An author uploads a voice memo, receives an editable transcript, and explicitly uses it as source material for the existing assistant. MP3, WAV, M4A and Ogg are accepted up to 10 MiB. Audio is ephemeral request data, not a second asset library. WebM is excluded because the installed provider SDK does not serialize it.

### Changes and evidence
- `lib/write/voice-memo.ts`: strict base64 contract, byte bounds and format signature checks.
- `lib/write/transcribe.ts`: registry role `transcription`, 90-second timeout, no automatic provider retry; incomplete output is rejected.
- `app/api/v1/content-drafts/transcribe/route.ts`: session edit permission, AI policy and authorized draft context before model use.
- `components/write/composer/voice-memo.tsx`: file selection, explicit transcription, review and use; maximum 7,600 transcript characters fits the assistant's message contract.
- Registry default `google/gemini-2.5-flash`, overridable with `PLATFORM_AI_MODEL_TRANSCRIPTION`. Public OpenRouter model metadata advertises audio input; its [audio documentation](https://openrouter.ai/docs/guides/overview/multimodal/audio) requires inline base64. Existing provider accounting and deny-data-collection routing apply. No database change.

### Acceptance criteria
1. Invalid, oversized or mislabeled files never initiate model spending.
2. Audio belongs to an authorized draft request; a foreign draft returns 404.
3. Transcription does not mutate the draft or send an assistant message.
4. Reviewed text can be edited, sent and explicitly inserted; publication still requires the normal human workflow.
5. Truncated output is rejected rather than silently presented as a complete transcript.

### Failure behavior
Keep the file and any prior transcript available on provider failure. Report unsupported format or incomplete transcription. Do not retry an uncertain paid request automatically.

### Verification and observability
`test/voice-memo.test.ts` passes format rejection, actual SDK inline-audio serialization and reported-cost metering. `test/e2e/typefully-ai.spec.ts` passes the browser handoff with a valid WAV and scripted transcript, including refresh and zero scheduled posts. It does not test speech recognition quality. Telemetry uses the transcription role; no audio or transcript is logged. Live provider accuracy and routing availability need a configured account.
