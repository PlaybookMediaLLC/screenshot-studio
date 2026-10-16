import 'server-only'

import { router } from './init'
import { announcementRouter, audienceRouter } from './routers/announcement'
import { apiKeyRouter } from './routers/api-key'
import { assetRouter } from './routers/asset'
import { billingRouter } from './routers/billing'
import { campaignRouter } from './routers/campaign'
import { brandKitRouter, brandProfileRouter, sourceAppRouter } from './routers/configuration'
import { creativeTemplateRouter, creativeVariantRouter } from './routers/creative'
import { designRouter } from './routers/design'
import { editorAiRouter } from './routers/editor-ai'
import { githubRouter } from './routers/github'
import { integrationRouter } from './routers/integration'
import { launchRouter } from './routers/launch'
import { productSurfaceRouter } from './routers/product-surface'
import { projectRouter } from './routers/project'
import { channelConnectionRouter, scheduledPostRouter } from './routers/publishing'
import { releaseRouter } from './routers/release'
import { shareLinkRouter } from './routers/share-link'
import { workspaceRouter } from './routers/workspace'

export const appRouter = router({
  announcement: announcementRouter,
  apiKey: apiKeyRouter,
  audience: audienceRouter,
  asset: assetRouter,
  billing: billingRouter,
  brandKit: brandKitRouter,
  brandProfile: brandProfileRouter,
  campaign: campaignRouter,
  channelConnection: channelConnectionRouter,
  creativeTemplate: creativeTemplateRouter,
  creativeVariant: creativeVariantRouter,
  design: designRouter,
  editorAi: editorAiRouter,
  github: githubRouter,
  integration: integrationRouter,
  launch: launchRouter,
  productSurface: productSurfaceRouter,
  project: projectRouter,
  release: releaseRouter,
  scheduledPost: scheduledPostRouter,
  shareLink: shareLinkRouter,
  sourceApp: sourceAppRouter,
  workspace: workspaceRouter,
})

export type AppRouter = typeof appRouter
