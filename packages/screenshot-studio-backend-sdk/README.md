# Screenshot Studio backend SDK

Typed TypeScript client for the Go backend's publishing and social OAuth APIs.
The Next.js server uses it through `lib/tenant/publishing-backend.ts`; UI calls
remain on the same-origin tRPC routes.

Instantiate only in a trusted server process. The client sends a private
`PUBLISHING_SERVICE_TOKEN` and the current session ID. The Go API validates
that session and its workspace role from the shared database before each
operation. Never put the service token in browser code or `NEXT_PUBLIC_*` env.

The package's current methods list, create, and cancel scheduled posts; list
and create channel connections; and begin, verify, remember, and complete social
OAuth. The returned post status includes `UNKNOWN_DELIVERY`, which requires
remote reconciliation before any retry.
