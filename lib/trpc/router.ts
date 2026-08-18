import 'server-only'

import { router } from './init'
import { apiKeyRouter } from './routers/api-key'
import { assetRouter } from './routers/asset'
import { campaignRouter } from './routers/campaign'
import { brandKitRouter, brandProfileRouter, sourceAppRouter } from './routers/configuration'
import { creativeTemplateRouter, creativeVariantRouter } from './routers/creative'
import { productSurfaceRouter } from './routers/product-surface'
import { channelConnectionRouter, scheduledPostRouter } from './routers/publishing'
import { releaseRouter } from './routers/release'
import { workspaceRouter } from './routers/workspace'

export const appRouter = router({
  apiKey: apiKeyRouter,
  asset: assetRouter,
  brandKit: brandKitRouter,
  brandProfile: brandProfileRouter,
  campaign: campaignRouter,
  channelConnection: channelConnectionRouter,
  creativeTemplate: creativeTemplateRouter,
  creativeVariant: creativeVariantRouter,
  productSurface: productSurfaceRouter,
  release: releaseRouter,
  scheduledPost: scheduledPostRouter,
  sourceApp: sourceAppRouter,
  workspace: workspaceRouter,
})

export type AppRouter = typeof appRouter
