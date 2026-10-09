import { getActiveOrganizationId, signUpAndCreateWorkspace } from './framework/auth'
import { configureE2EFlow, expect, test } from './framework/flow'
import { createE2EDatabaseClient } from './framework/services'
import { trpcMutation } from './framework/trpc'

/**
 * The launch pipeline end to end: a release with only a title and source
 * links becomes a cited spec (the injection attempt in one source is flagged
 * and ignored), a plan, a produced campaign with provenance, and a reviewer's
 * AI revision that changes one post and nothing else. The app runs with the
 * scripted model (PLATFORM_AI_SCRIPTED=1, see bin/studio), so this needs no
 * provider key; the mock serves the sources and a real product screenshot.
 */

configureE2EFlow()

const MOCK = 'http://screenshot-mock:5678'
const RUN_TIMEOUT = 90_000

test('a release becomes a cited spec, a plan, a produced campaign, and a revised post', async ({
  identity,
  page,
}) => {
  test.slow()
  await signUpAndCreateWorkspace(identity, page)
  const organizationId = await getActiveOrganizationId(page)

  const surface = await trpcMutation(page, 'productSurface.create', {
    name: 'Ledgerly',
    url: `${MOCK}/product`,
  })
  expect(surface.status).toBe(200)
  const surfaceId = (surface.body as { productSurface: { id: string } }).productSurface.id
  // Only a title and source links: why it matters comes from the sources.
  const release = await trpcMutation(page, 'release.create', {
    productSurfaceId: surfaceId,
    sourceUrls: [`${MOCK}/changelog`, `${MOCK}/notes`],
    title: 'Recurring invoices',
  })
  expect(release.status).toBe(200)
  const releaseId = (release.body as { release: { id: string } }).release.id
  const created = await trpcMutation(page, 'campaign.create', {
    name: 'Recurring invoices launch',
    objective: 'Launch',
    releaseId,
  })
  const campaignId = (created.body as { campaign: { id: string } }).campaign.id

  // ---------------------------------------------------------------- spec
  await page.goto(`/campaigns/${campaignId}/spec`)
  await page.getByRole('button', { name: 'Draft spec' }).click()
  await expect(page.getByText(/Drafted from the brief and \d sources?/)).toBeVisible({
    timeout: RUN_TIMEOUT,
  })
  await expect(page.getByText('Recurring schedules', { exact: false }).first()).toBeVisible()
  // The notes page tried a prompt injection: it is flagged, and none of it is repeated.
  await expect(page.getByText('Flagged', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('#1 billing tool')).toHaveCount(0)
  await expect(page.getByText('customer list')).toHaveCount(0)
  await expect(page.getByText('What measurable result can we cite?')).toBeVisible()
  await page.getByRole('button', { name: 'Approve spec' }).click()
  await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible()

  const prisma = createE2EDatabaseClient()
  try {
    const spec = await prisma.releaseSpec.findFirstOrThrow({ where: { releaseId } })
    expect(spec.status).toBe('APPROVED')
    const sources = spec.sources as Array<{
      flagged: boolean
      id: string
      status: string
      url: string
    }>
    expect(sources.find((source) => source.url.endsWith('/notes'))?.flagged).toBe(true)
    expect(sources.find((source) => source.url.endsWith('/changelog'))?.flagged).toBe(false)
    const flaggedId = sources.find((source) => source.flagged)!.id
    expect(JSON.stringify(spec.content)).not.toContain(`"${flaggedId}"`)

    // A person's edit may not cite a source that does not exist.
    const content = spec.content as { problem: Array<{ sources: string[]; text: string }> }
    const forged = await trpcMutation(page, 'launch.spec.update', {
      baseSpecId: spec.id,
      campaignId,
      content: { ...content, problem: [{ sources: ['S9'], text: 'Invented claim' }] },
      summary: 'Forged citation',
    })
    expect(forged.status).toBe(400)
    expect(JSON.stringify(forged.body)).toContain('S9')

    // ---------------------------------------------------------------- plan
    await page.goto(`/campaigns/${campaignId}/plan`)
    await page.getByRole('button', { name: 'Plan campaign' }).click()
    await expect(page.getByText('Planned from spec v1').first()).toBeVisible({
      timeout: RUN_TIMEOUT,
    })
    await expect(page.getByText('Launch day').first()).toBeVisible()
    await page.getByRole('button', { name: 'Approve plan' }).click()
    await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible()

    // ------------------------------------------------------------- produce
    await page.goto(`/campaigns/${campaignId}/assets`)
    await page.getByRole('button', { name: 'Produce campaign' }).click()
    await expect(page.getByText('Variant B').first()).toBeVisible({ timeout: RUN_TIMEOUT })

    const assets = await prisma.campaignAsset.findMany({ where: { campaignId } })
    const shots = assets.filter((asset) => asset.kind === 'product-shot')
    expect(shots.map((shot) => `${shot.planAssetKey}${shot.variantLabel ?? ''}`).sort()).toEqual([
      'A1A',
      'A1B',
      'A2',
    ])
    const posts = await prisma.campaignPost.findMany({
      orderBy: { createdAt: 'asc' },
      where: { campaignId },
    })
    expect(new Set(posts.map((post) => post.channel))).toEqual(
      new Set(['x', 'linkedin', 'product_hunt', 'changelog', 'email'])
    )
    for (const post of posts) {
      expect(post.specVersion).toBe(1)
      expect((post.claims as Array<{ ref: string }>).length).toBeGreaterThan(0)
    }

    // -------------------------------------------------------------- revise
    const target = posts.find((post) => post.channel === 'linkedin')!
    await page.goto(`/campaigns/${campaignId}/copy`)
    await page.getByRole('tab', { name: /LinkedIn/ }).click()
    const card = page.getByRole('article').filter({ hasText: target.copy.slice(0, 40) })
    await card.getByRole('button', { name: 'Revise with AI' }).click()
    await page.getByLabel('What should change?').fill('Lead with the time saved')
    await page.getByRole('button', { name: 'Propose changes' }).click()
    await expect(page.locator('ins').filter({ hasText: 'Get hours back each month.' })).toBeVisible(
      {
        timeout: RUN_TIMEOUT,
      }
    )
    await page.getByRole('button', { name: 'Apply changes' }).click()
    // The diff shows the new text too; wait for the apply itself, then the card.
    await expect(page.getByText('Revision applied')).toBeVisible({ timeout: RUN_TIMEOUT })
    await expect(card.getByText(/^Get hours back each month\./)).toBeVisible()

    const after = await prisma.campaignPost.findMany({
      orderBy: { createdAt: 'asc' },
      where: { campaignId },
    })
    const revised = after.find((post) => post.id === target.id)!
    expect(revised.copy.startsWith('Get hours back each month.')).toBe(true)
    // One piece changed; every other post is exactly as it was.
    for (const post of after.filter((entry) => entry.id !== target.id)) {
      expect(post.copy).toBe(posts.find((entry) => entry.id === post.id)!.copy)
    }
    const revision = await prisma.campaignRevision.findFirstOrThrow({ where: { campaignId } })
    expect(revision.status).toBe('APPLIED')
    expect(revision.comment).toBe('Lead with the time saved')

    const actions = (
      await prisma.auditLog.findMany({ select: { action: true }, where: { organizationId } })
    ).map((entry) => entry.action)
    for (const action of [
      'product.release_spec_generated',
      'product.release_spec_approved',
      'product.campaign_plan_generated',
      'product.campaign_plan_approved',
      'product.campaign_produced',
      'product.campaign_copy_generated',
      'product.campaign_revision_proposed',
      'product.campaign_revision_applied',
    ]) {
      expect(actions).toContain(action)
    }
  } finally {
    await prisma.$disconnect()
  }
})
