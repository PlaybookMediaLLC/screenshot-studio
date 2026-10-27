import { config } from 'dotenv'
import { Pool } from 'pg'
import { z } from 'zod'

config({ path: '.local/dev.env', override: false, quiet: true })

const [organizationId, secretReference] = process.argv.slice(2)
const referenceSchema = z.string().regex(/^SOCIAL_(?:API_KEY|OAUTH_TOKEN)(?:_[A-Z0-9_]+)?$/)
class BindingError extends Error {}

async function main(): Promise<void> {
  if (!organizationId || !referenceSchema.safeParse(secretReference).success) {
    throw new BindingError(
      'Usage: tsx scripts/bind-social-tenant.ts <web-organization-id> <SOCIAL_API_KEY_REFERENCE>'
    )
  }
  const apiKey = process.env[secretReference]
  if (!apiKey) throw new BindingError('The referenced social API key is unavailable.')
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
    await database.query('BEGIN')
    const {
      rows: [webOrganization],
    } = await database.query<{ name: string }>('SELECT name FROM organization WHERE id = $1', [
      organizationId,
    ])
    if (!webOrganization) throw new BindingError('Web organization was not found.')
    // The social organization that holds the referenced key, created here when
    // none does: the product connects channels in process, without a social API.
    const {
      rows: [socialOrganization],
    } = await database.query<{ id: string }>(
      `SELECT id FROM "Organization" WHERE "apiKey" = $1 AND "deletedAt" IS NULL`,
      [apiKey]
    )
    const goOrganizationId =
      socialOrganization?.id ??
      (
        await database.query<{ id: string }>(
          `INSERT INTO "Organization" (id, name, "apiKey", "updatedAt")
           VALUES (gen_random_uuid()::text, $1, $2, now()) RETURNING id`,
          [webOrganization.name, apiKey]
        )
      ).rows[0].id
    const {
      rows: [existing],
    } = await database.query<{ goOrganizationId: string; secretReference: string }>(
      'SELECT "goOrganizationId", "secretReference" FROM social_tenant_binding WHERE "organizationId" = $1',
      [organizationId]
    )
    if (existing) {
      if (
        existing.goOrganizationId !== goOrganizationId ||
        existing.secretReference !== secretReference
      ) {
        throw new BindingError(
          'This web organization is already bound to different social API credentials.'
        )
      }
      await database.query('ROLLBACK')
      process.stdout.write('Social organization binding is already present.\n')
      return
    }
    await database.query(
      `INSERT INTO social_tenant_binding ("organizationId", "goOrganizationId", "secretReference", "createdAt")
       VALUES ($1, $2, $3, now())`,
      [organizationId, goOrganizationId, secretReference]
    )
    await database.query('COMMIT')
    process.stdout.write('Social organization binding created.\n')
  } catch (error) {
    await database.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    await database.end()
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof BindingError ? error.message : 'Social binding failed; check the local database configuration.'}\n`
  )
  process.exitCode = 1
})
