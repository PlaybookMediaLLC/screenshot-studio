import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { CampaignBrief } from '@/components/campaigns/CampaignBrief'
import { CampaignStudioButton } from '@/components/campaigns/CampaignStudioButton'
import { CampaignStatusPill } from '@/components/campaigns/CampaignStatusPill'
import { Group, Page, Row, Section } from '@/components/platform-ui'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { isCampaignStudioConfigured } from '@/lib/ai/agents/campaign-studio'
import { hasPermission } from '@/lib/auth/permissions'
import { createTenantDownloadUrl } from '@/lib/storage/client'
import { getCampaign } from '@/lib/tenant/campaigns'
import { listCampaignDesigns } from '@/lib/tenant/designs'
import { requireCampaignPageAccess } from '../page-access'

export const metadata: Metadata = { title: 'Campaign | Screenshot Studio' }

type CampaignPageProps = {
  params: Promise<{ campaignId: string; locale: string }>
}

/** Signed for long enough to render the page; a refresh re-signs. */
async function signAssetUrl(organizationId: string, objectKey: string): Promise<string | null> {
  try {
    return await createTenantDownloadUrl({ expiresIn: 900, objectKey, organizationId })
  } catch {
    return null
  }
}

function formatTimestamp(value: Date): string {
  return value.toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })
}

/** A quiet placeholder for a section with nothing in it yet. */
function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-white/[0.015] px-6 py-10 text-center text-sm text-neutral-500 ring-1 ring-white/[0.06]">
      {children}
    </div>
  )
}

/**
 * The campaign's home. Everything here is read from the server on each
 * request, so a refresh or a new session shows exactly what was saved.
 * Sections for assets and copy are placeholders until generation lands.
 */
export default async function CampaignPage({ params }: CampaignPageProps) {
  const { campaignId, locale } = await params
  const access = await requireCampaignPageAccess(locale)
  // Scoped to the active workspace: another workspace's id is a 404.
  const campaign = await getCampaign(access.organization.id, campaignId)
  if (!campaign) notFound()
  const designs = await listCampaignDesigns(access.organization.id, campaign.id)
  const captionByAsset = new Map(campaign.assets.map((link) => [link.assetId, link.caption]))
  // Rendered designs open as editable compositions; legacy product shots as images.
  const gallery = await Promise.all([
    ...designs
      .filter((design) => design.renderedAsset)
      .map(async (design) => ({
        caption: captionByAsset.get(design.renderedAsset!.id) ?? design.name,
        editHref: `/?design=${design.id}`,
        height: design.renderedAsset!.height,
        id: design.id,
        url: await signAssetUrl(access.organization.id, design.renderedAsset!.objectKey),
        width: design.renderedAsset!.width,
      })),
    ...campaign.assets
      .filter((link) => link.kind === 'product-shot')
      .map(async (link) => ({
        caption: link.caption,
        editHref: `/?asset=${link.asset.id}`,
        height: link.asset.height,
        id: link.id,
        url: await signAssetUrl(access.organization.id, link.asset.objectKey),
        width: link.asset.width,
      })),
  ])
  const draftDesigns = designs.filter((design) => !design.renderedAsset)
  const captureCount = campaign.assets.filter((link) => link.kind.startsWith('capture-')).length

  return (
    <PlatformShell campaignsEnabled organizationName={access.organization.name}>
      <Page
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <CampaignStatusPill status={campaign.status} />
            <span>
              Created {formatTimestamp(campaign.createdAt)} UTC · Updated{' '}
              {formatTimestamp(campaign.updatedAt)} UTC
            </span>
          </span>
        }
        title={campaign.name}
        width="md"
      >
        <CampaignBrief
          campaign={{
            id: campaign.id,
            postCount: campaign.posts.length,
            status: campaign.status,
          }}
          canApprove={hasPermission(access.role, 'release:approve')}
          canEdit={hasPermission(access.role, 'release:create')}
          productSurface={campaign.productSurface}
          release={
            campaign.release && {
              ...campaign.release,
              sourceUrls: Array.isArray(campaign.release.sourceUrls)
                ? campaign.release.sourceUrls.filter((url) => typeof url === 'string')
                : [],
            }
          }
        />

        <Section
          description="Product shots and designs built for this release."
          id="campaign-assets"
          title="Assets"
        >
          <CampaignStudioButton
            campaignId={campaign.id}
            canGenerate={hasPermission(access.role, 'release:create') && Boolean(campaign.release)}
            configured={isCampaignStudioConfigured()}
            hasAssets={campaign.assets.length > 0}
          />
          {gallery.length === 0 ? (
            <Placeholder>Designs for this release will appear here.</Placeholder>
          ) : (
            <ul className="grid items-start gap-4 sm:grid-cols-2">
              {gallery.map((shot) => (
                <li
                  className="overflow-hidden rounded-xl bg-white/[0.015] ring-1 ring-white/[0.08]"
                  key={shot.id}
                >
                  {shot.url ? (
                    // Signed, short-lived tenant URLs: next/image would cache them past expiry.
                    <img
                      alt={shot.caption ?? 'Product shot'}
                      className="aspect-auto w-full bg-neutral-900"
                      height={shot.height ?? undefined}
                      src={shot.url}
                      width={shot.width ?? undefined}
                    />
                  ) : (
                    <div className="p-6 text-sm text-neutral-500">Preview unavailable.</div>
                  )}
                  <div className="flex items-start justify-between gap-3 border-t border-white/[0.07] px-4 py-3">
                    <p className="text-xs text-neutral-500">{shot.caption}</p>
                    <Link
                      className="shrink-0 text-xs font-medium text-white hover:underline"
                      href={shot.editHref}
                    >
                      Open in editor
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {draftDesigns.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-neutral-500">
                {draftDesigns.length} more variation{draftDesigns.length === 1 ? '' : 's'}, not
                rendered
              </p>
              <ul className="flex flex-wrap gap-2">
                {draftDesigns.map((design) => (
                  <li key={design.id}>
                    <Link
                      className="inline-flex rounded-lg px-2.5 py-1 text-xs text-neutral-300 ring-1 ring-white/[0.08] transition-colors hover:bg-white/[0.04] hover:text-white"
                      href={`/?design=${design.id}`}
                    >
                      {design.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {captureCount > 0 ? (
            <p className="text-xs text-neutral-500">
              Built from {captureCount} live capture{captureCount === 1 ? '' : 's'} of your product.
            </p>
          ) : null}
        </Section>

        <Section description="Posts drafted for each channel." id="campaign-copy" title="Copy">
          {campaign.posts.length === 0 ? (
            <Placeholder>
              Posts for each channel will appear here. Editing the brief keeps them intact.
            </Placeholder>
          ) : (
            <Group>
              {campaign.posts.map((post) => (
                <Row key={post.id}>
                  <p className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
                    {post.channel} · {post.status}
                  </p>
                  <p className="text-sm whitespace-pre-wrap text-white">{post.copy}</p>
                  {post.callToAction ? (
                    <p className="text-xs font-medium text-neutral-300">CTA: {post.callToAction}</p>
                  ) : null}
                </Row>
              ))}
            </Group>
          )}
        </Section>
      </Page>
    </PlatformShell>
  )
}
