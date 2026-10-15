import 'server-only'

import type { OrganizationAccess } from '@/lib/auth/access'
import type { SessionPrincipal } from '@/lib/auth/principal'
import { backendSDK } from '@/lib/backend/sdk'
import { BackendSDKError, type ProductSurface } from 'screenshot-studio-backend-sdk'
import type { ProductSurfaceCreateInput, ProductSurfaceUpdateInput } from './schemas'

type ProductSurfaceAccess = {
  organizationId: string
  principal: SessionPrincipal
  requestId: string
}

function fromBackend(surface: ProductSurface) {
  return {
    ...surface,
    createdAt: new Date(surface.createdAt),
    updatedAt: new Date(surface.updatedAt),
  }
}

export async function listProductSurfaces(context: ProductSurfaceAccess) {
  const result = await backendSDK(context).listProductSurfaces()
  return result.productSurfaces.map(fromBackend)
}

export async function createProductSurface(
  context: OrganizationAccess,
  input: ProductSurfaceCreateInput
) {
  return fromBackend(await backendSDK(context).createProductSurface(input))
}

export async function updateProductSurface(
  context: OrganizationAccess,
  surfaceId: string,
  input: ProductSurfaceUpdateInput
) {
  try {
    return fromBackend(await backendSDK(context).updateProductSurface(surfaceId, input))
  } catch (error) {
    if (error instanceof BackendSDKError && error.status === 404) return null
    throw error
  }
}

export async function deleteProductSurface(context: OrganizationAccess, surfaceId: string) {
  try {
    await backendSDK(context).deleteProductSurface(surfaceId)
    return { id: surfaceId }
  } catch (error) {
    if (error instanceof BackendSDKError && error.status === 404) return null
    throw error
  }
}
