import 'server-only'

import { router } from './init'
import { announcementRouter, audienceRouter } from './routers/announcement'
import { apiKeyRouter } from './routers/api-key'
import { assetRouter } from './routers/asset'
import { billingRouter } from './routers/billing'
import { campaignRouter } from './routers/campaign'
import { brandKitRouter, brandProfileRouter, sourceAppRouter } from './routers/configuration'
import { conversationRouter } from './routers/conversation'
import { creativeTemplateRouter, creativeVariantRouter } from './routers/creative'
import { designRouter } from './routers/design'
import { editorAiRouter } from './routers/editor-ai'
import { githubRouter } from './routers/github'
import { launchRouter } from './routers/launch'
import { onboardingRouter } from './routers/onboarding'
import { productProfileRouter } from './routers/product-profile'
import { productSurfaceRouter } from './routers/product-surface'
import { channelConnectionRouter, scheduledPostRouter } from './routers/publishing'
import { releaseRouter } from './routers/release'
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
  conversation: conversationRouter,
  creativeTemplate: creativeTemplateRouter,
  creativeVariant: creativeVariantRouter,
  design: designRouter,
  editorAi: editorAiRouter,
  github: githubRouter,
  launch: launchRouter,
  onboarding: onboardingRouter,
  productProfile: productProfileRouter,
  productSurface: productSurfaceRouter,
  release: releaseRouter,
  scheduledPost: scheduledPostRouter,
  sourceApp: sourceAppRouter,
  workspace: workspaceRouter,
})

export type AppRouter = typeof appRouter
