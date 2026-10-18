import {
  completeAssetUploadContract,
  createAssetDownloadUrlContract,
  createAssetUploadUrlContract,
  deleteAssetContract,
} from '@/lib/api/contracts/assets'
import {
  createContentDraftContract,
  deleteContentDraftContract,
  getContentDraftContract,
  listContentDraftPostsContract,
  listContentDraftsContract,
  updateContentDraftContract,
} from '@/lib/api/contracts/content-drafts'
import { getLinkPreviewContract } from '@/lib/api/contracts/link-preview'
import {
  cancelOnboardingRunContract,
  createOnboardingRunContract,
  getOnboardingRunContract,
  listOnboardingEnrichmentContract,
  rerunOnboardingRunContract,
} from '@/lib/api/contracts/onboarding-runs'
import { createReleaseContract, listReleasesContract } from '@/lib/api/contracts/releases'
import {
  activateOrganizationContract,
  getBootstrapContract,
  getCurrentUserContract,
  getOrganizationCapabilitiesContract,
  getOrganizationContract,
  getOrganizationPermissionsContract,
  getOrganizationSettingsContract,
  listOrganizationInvitationsContract,
  listOrganizationMembersContract,
  listOrganizationsContract,
} from '@/lib/api/contracts/shell'
import { createSourceAppContract, updateSourceAppContract } from '@/lib/api/contracts/source-apps'

/** Every contract in the public OpenAPI spec, in the order the spec lists them. */
export const documentedContracts = [
  listReleasesContract,
  createReleaseContract,
  createSourceAppContract,
  updateSourceAppContract,
  getLinkPreviewContract,
  createAssetUploadUrlContract,
  completeAssetUploadContract,
  createAssetDownloadUrlContract,
  deleteAssetContract,
  listContentDraftsContract,
  createContentDraftContract,
  getContentDraftContract,
  updateContentDraftContract,
  deleteContentDraftContract,
  listContentDraftPostsContract,
  createOnboardingRunContract,
  getOnboardingRunContract,
  cancelOnboardingRunContract,
  rerunOnboardingRunContract,
  listOnboardingEnrichmentContract,
  getCurrentUserContract,
  getBootstrapContract,
  listOrganizationsContract,
  getOrganizationContract,
  listOrganizationMembersContract,
  listOrganizationInvitationsContract,
  getOrganizationSettingsContract,
  getOrganizationPermissionsContract,
  getOrganizationCapabilitiesContract,
  activateOrganizationContract,
]
