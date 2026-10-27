import { config } from 'dotenv'
import { Pool } from 'pg'
import { z } from 'zod'

config({ path: '.local/dev.env', override: false, quiet: true })

const [organizationId, secretReference] = process.argv.slice(2)
const referenceSchema = z.string().regex(/^SOCIAL_(?:API_KEY|OAUTH_TOKEN)(?:_[A-Z0-9_]+)?$/)
const meSchema = z.object({ organization: z.object({ id: z.string().min(1) }) })
class BindingError extends Error {}

async function main(): Promise<void> {
  if (!organizationId || !referenceSchema.safeParse(secretReference).success) {
    throw new BindingError(
      'Usage: tsx scripts/bind-social-tenant.ts <web-organization-id> <SOCIAL_API_KEY_REFERENCE>'
    )
  }
  const apiKey = process.env[secretReference]
  const apiURL = process.env.SOCIAL_BIND_API_URL ?? process.env.SOCIAL_API_URL
  if (!apiKey || !apiURL) throw new BindingError('Social API URL or referenced key is unavailable.')
  // An operator tool run against the backend database, not part of the web runtime.
  const databaseURL = new URL(
    process.env.SOCIAL_BIND_DATABASE_URL ??
      process.env.HOST_DATABASE_URL ??
      process.env.DATABASE_URL ??
      ''
  )
  databaseURL.searchParams.delete('schema')
  const database = new Pool({ connectionString: databaseURL.toString() })
  try {
    const webOrganization = await database.query('SELECT id FROM organization WHERE id = $1', [
      organizationId,
    ])
    if (webOrganization.rowCount === 0) throw new BindingError('Web organization was not found.')
    const response = await fetch(new URL('me', `${apiURL.replace(/\/$/, '')}/`), {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok)
      throw new BindingError('The referenced social API key could not read its organization.')
    const me = meSchema.parse(await response.json())
    const {
      rows: [existing],
    } = await database.query<{ goOrganizationId: string; secretReference: string }>(
      'SELECT "goOrganizationId", "secretReference" FROM social_tenant_binding WHERE "organizationId" = $1',
      [organizationId]
    )
    if (existing) {
      if (
        existing.goOrganizationId !== me.organization.id ||
        existing.secretReference !== secretReference
      ) {
        throw new BindingError(
          'This web organization is already bound to different social API credentials.'
        )
      }
      process.stdout.write('Social organization binding is already present.\n')
      return
    }
    await database.query(
      `INSERT INTO social_tenant_binding ("organizationId", "goOrganizationId", "secretReference", "createdAt")
       VALUES ($1, $2, $3, now())`,
      [organizationId, me.organization.id, secretReference]
    )
    process.stdout.write('Social organization binding created.\n')
  } finally {
    await database.end()
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof BindingError ? error.message : 'Social binding failed; check the local database and API configuration.'}\n`
  )
  process.exitCode = 1
})
