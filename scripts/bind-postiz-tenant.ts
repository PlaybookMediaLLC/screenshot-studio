import { PrismaClient } from '@prisma/client'
import { config } from 'dotenv'
import { z } from 'zod'

config({ path: '.local/dev.env', override: false, quiet: true })

const [organizationId, secretReference] = process.argv.slice(2)
const referenceSchema = z.string().regex(/^POSTIZ_(?:API_KEY|OAUTH_TOKEN)(?:_[A-Z0-9_]+)?$/)
const meSchema = z.object({ organization: z.object({ id: z.string().min(1) }) })
class BindingError extends Error {}

async function main(): Promise<void> {
  if (!organizationId || !referenceSchema.safeParse(secretReference).success) {
    throw new BindingError(
      'Usage: tsx scripts/bind-postiz-tenant.ts <web-organization-id> <POSTIZ_API_KEY_REFERENCE>'
    )
  }
  const apiKey = process.env[secretReference]
  const apiURL = process.env.POSTIZ_BIND_API_URL ?? process.env.POSTIZ_API_URL
  if (!apiKey || !apiURL) throw new BindingError('Postiz API URL or referenced key is unavailable.')
  process.env.DATABASE_URL =
    process.env.POSTIZ_BIND_DATABASE_URL ??
    process.env.HOST_DATABASE_URL ??
    process.env.DATABASE_URL
  const prisma = new PrismaClient()
  try {
    const webOrganization = await prisma.organization.findUnique({
      select: { id: true },
      where: { id: organizationId },
    })
    if (!webOrganization) throw new BindingError('Web organization was not found.')
    const response = await fetch(new URL('me', `${apiURL.replace(/\/$/, '')}/`), {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok)
      throw new BindingError('The referenced Postiz key could not read its organization.')
    const me = meSchema.parse(await response.json())
    const existing = await prisma.postizTenantBinding.findUnique({
      where: { organizationId },
    })
    if (existing) {
      if (
        existing.goOrganizationId !== me.organization.id ||
        existing.secretReference !== secretReference
      ) {
        throw new BindingError(
          'This web organization is already bound to different Postiz credentials.'
        )
      }
      process.stdout.write('Postiz organization binding is already present.\n')
      return
    }
    await prisma.postizTenantBinding.create({
      data: { goOrganizationId: me.organization.id, organizationId, secretReference },
    })
    process.stdout.write('Postiz organization binding created.\n')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof BindingError ? error.message : 'Postiz binding failed; check the local database and API configuration.'}\n`
  )
  process.exitCode = 1
})
