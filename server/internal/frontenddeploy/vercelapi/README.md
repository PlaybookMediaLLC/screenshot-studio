# Vercel read SDK

This SDK is generated with pinned `oapi-codegen` v2.5.1 from a projection of
[Vercel's official OpenAPI contract](https://openapi.vercel.sh/). It is not an
official Vercel Go distribution. Vercel's standalone SDK is TypeScript; the Go
Terraform client does not expose the check-result operation or an injectable
HTTP transport. Generating these two read operations keeps credentials and
polling inside the existing Go backend without adding a Node runtime/service.

`openapi.json` retains the upstream paths, parameters, security scheme and field
types for project ownership and deployment checks. Unused response fields and
operations are excluded. Its metadata records the full upstream document hash.

To update, download `https://openapi.vercel.sh/` to a local file, run
`python3 refresh.py /path/to/file.json`, then `go generate` and review the diff.
Normal regeneration uses the checked-in projection and needs no live provider.
Do not edit `client.gen.go` manually. The calling adapter supplies the existing
bounded, read-only, fixed-host transport and performs production policy evaluation.
