import 'server-only'

import { getActiveBrand } from '@/lib/launch/store'
import { transitionCampaignPosts } from '@/lib/tenant/campaigns'
import { getProductProfile } from '@/lib/tenant/product-profile'
import {
  captureProductSurface,
  findSurfacesForFeature,
  listProductSurfaces,
} from '@/lib/tenant/product-surfaces'
import type { MarketingServices } from './marketing'

/** The server's domain services for `marketingTools`, the same ones the UI calls. */
export const marketingServices: MarketingServices = {
  captureProductSurface,
  findSurfacesForFeature,
  getActiveBrand,
  getProductProfile,
  listProductSurfaces,
  transitionCampaignPosts,
}
