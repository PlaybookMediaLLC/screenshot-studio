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
