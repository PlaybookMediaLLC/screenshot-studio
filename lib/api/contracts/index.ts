import {
  decideCampaignApprovalContract,
  listApprovalsContract,
  requestCampaignReviewContract,
} from '@/lib/api/contracts/approvals'
import {
  completeAssetUploadContract,
  createAssetDownloadUrlContract,
  createAssetUploadUrlContract,
  deleteAssetContract,
} from '@/lib/api/contracts/assets'
import {
  createCampaignContract,
  getCampaignContract,
  listCampaignsContract,
  transitionCampaignContract,
} from '@/lib/api/contracts/campaigns'
import {
  createContentDraftContract,
  deleteContentDraftContract,
  getContentDraftContract,
  listContentDraftPostsContract,
  listContentDraftsContract,
  updateContentDraftContract,
} from '@/lib/api/contracts/content-drafts'
import { getLinkPreviewContract } from '@/lib/api/contracts/link-preview'
import { createReleaseContract, listReleasesContract } from '@/lib/api/contracts/releases'
import {
  cancelScheduledPostContract,
  createScheduledPostContract,
  listScheduledPostsContract,
} from '@/lib/api/contracts/scheduled-posts'
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
  listCampaignsContract,
  createCampaignContract,
  getCampaignContract,
  transitionCampaignContract,
  listApprovalsContract,
  requestCampaignReviewContract,
  decideCampaignApprovalContract,
  listScheduledPostsContract,
  createScheduledPostContract,
  cancelScheduledPostContract,
  listContentDraftsContract,
  createContentDraftContract,
  getContentDraftContract,
  updateContentDraftContract,
  deleteContentDraftContract,
  listContentDraftPostsContract,
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
