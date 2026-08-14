---
name: add-background-task
description: Add or change a Screenshot Studio Trigger.dev background task. Use for artifact generation, media processing, Steel capture, scheduled delivery, provider reconciliation, retries, queues, outbox dispatch, or task observability.
---

# Add Background Task

Read RFC 004, RFC 005, RFC 006, and RFC 007. A task executes a durable side
effect; PlanetScale remains the tenant state and authorization source.

## Task contract

1. Define the business event, record lifecycle, queue, concurrency key, and
   retry classes before writing task code.
2. Write the state transition, audit event, and `OutboxEvent` in one database
   transaction. Dispatch after commit.
3. Send only stable IDs, versions, idempotency key, and request ID to Trigger.
   Do not send sessions, raw keys, provider tokens, or R2 signed URLs.
4. Re-read the record, organization status, approval, and connection state
   immediately before an external side effect.
5. Atomically claim the business action, save a receipt or safe failure code,
   and make retries return when the prior action completed.

## Queue rules

- Give costly work an explicit queue and tenant or connection concurrency key.
- Limit captures by organization and publishing by channel connection.
- Separate retryable, permanent, security, and unknown errors.
- Reconcile an unknown provider result before attempting a second publication.
- Schedule from durable PlanetScale state; do not rely on long-lived task waits
  for calendar dates beyond the supported queue window.

## Verification

- Test duplicate dispatch, crash after commit, retry after provider timeout,
  cancelled release, revoked approval, and cross-tenant IDs.
- Check task logs contain IDs and redacted metadata only.
- Measure queue age, duplicate side effects, failure rate, and worker cost.
