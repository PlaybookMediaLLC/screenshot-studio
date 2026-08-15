# Downstream dependencies

Choose the lowest-fidelity substitute that still validates the changed
contract.

| Boundary                                 | Default                                  | Use a real container when                                  |
| ---------------------------------------- | ---------------------------------------- | ---------------------------------------------------------- |
| Browser request to a third party         | `mockBrowserJson`                        | Browser or protocol behavior is the feature contract.      |
| Server request to a third party          | Inject a local mock URL before app start | The SDK, protocol, or callback contract must run for real. |
| Postgres, Redis, MinIO, Storage          | Existing Compose stack                   | A different version or dependency topology is under test.  |
| New queue, database, or protocol service | Testcontainers                           | It is not part of Compose and its real behavior matters.   |

## Browser mocks

Use `mockBrowserJson` only for browser-originated requests. Verify the UI and
the captured request. Include success, a safe error response, and a timeout or
retry case when the feature retries.

## Server mocks

Make the downstream base URL a server-only environment setting. Start the mock
before `make up`, then pass its URL to the application. Do not use
`page.route()` for server-side calls; it cannot observe them.

## Testcontainers

Add `testcontainers` as a development dependency only when Compose cannot
provide the dependency. Start the container before the application process,
inject its connection URL through test-only environment variables, wait for its
health check, and stop it in `afterAll`. Use a pinned image and a unique
database, bucket, queue, or topic name per test run.

Do not replace the normal Compose stack with Testcontainers without a concrete
isolation need. The browser suite must continue to validate the supported local
and CI deployment shape.
