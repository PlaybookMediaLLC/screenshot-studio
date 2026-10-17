/**
 * Writes the production OpenAPI document, the one `/openapi.json` serves, to
 * `services/internal/shotsapi/openapi.json`. The Go MCP server embeds that
 * file, the typed client is generated from it, and CI diffs it against the
 * base branch to block unintended breaking changes (RFC 034, RFC 037).
 */
import { writeFileSync } from 'node:fs'
import { openApiSpec } from '../lib/api/openapi'

const target = 'services/internal/shotsapi/openapi.json'

writeFileSync(target, `${JSON.stringify(openApiSpec, null, 2)}\n`)
process.stdout.write(`Wrote ${target}\n`)
