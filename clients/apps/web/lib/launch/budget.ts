/**
 * Budgets sized to the plan: every visual (assets × variants) may be
 * designed, rendered, reviewed, fixed once, and rendered again.
 */
export function productionBudget(plan: {
  assets: Array<{ captureHint: { device: string; url: string }; variants: number }>
}) {
  const visuals = plan.assets.reduce((total, asset) => total + asset.variants, 0)
  const targets = new Set(
    plan.assets.map((asset) => `${asset.captureHint.url}|${asset.captureHint.device}`)
  ).size
  return {
    captures: Math.min(12, targets + 2),
    designs: Math.min(32, visuals * 2 + 4),
    productShots: Math.min(16, visuals + 2),
    renders: Math.min(32, visuals * 2 + 2),
    steps: Math.min(96, visuals * 7 + 12),
  }
}

/** What a production run needs to know about a design it may already have made. */
type ProducedDesign = {
  createdAt: Date
  critique: Record<string, unknown> | null
  planAssetKey: string | null
  planVersion: number | null
  renderedAssetId: string | null
  variantLabel: string | null
}

/**
 * The plan assets a production run still has to make. An asset is finished
 * when each of its variants has a design for this plan version that is
 * rendered, was not sent back by its review, and is newer than the brand kit.
 * A re-run after a partial or failed production then skips the finished
 * visuals instead of paying to make them again; a plan edit is a new version,
 * so it remakes everything.
 */
export function unproducedAssets<Asset extends { key: string; variants: number }>(
  assets: readonly Asset[],
  designs: readonly ProducedDesign[],
  { brandUpdatedAt, planVersion }: { brandUpdatedAt: Date | null; planVersion: number }
): Asset[] {
  const finished = designs.filter(
    (design) =>
      design.planVersion === planVersion &&
      design.renderedAssetId !== null &&
      design.critique?.verdict !== 'fix' &&
      (brandUpdatedAt === null || design.createdAt >= brandUpdatedAt)
  )
  return assets.filter((asset) => {
    const labels = new Set(
      finished.filter((design) => design.planAssetKey === asset.key).map((d) => d.variantLabel)
    )
    return asset.variants === 2 ? !(labels.has('A') && labels.has('B')) : labels.size === 0
  })
}
