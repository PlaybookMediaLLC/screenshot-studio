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
  scheduleCampaignPostContract,
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
import {
  cancelOnboardingRunContract,
  createOnboardingRunContract,
  getOnboardingRunContract,
  listOnboardingEnrichmentContract,
  rerunOnboardingRunContract,
} from '@/lib/api/contracts/onboarding-runs'
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
import {
  createDraftTagContract,
  deleteDraftTagContract,
  listDraftTagsContract,
  updateDraftTagContract,
} from '@/lib/api/contracts/draft-tags'
import {
  createSocialSetContract,
  deleteSocialSetContract,
  getSocialSetContract,
  listSocialSetsContract,
  lookupMentionsContract,
  updateSocialSetContract,
} from '@/lib/api/contracts/social-sets'
import {
  contentDraftActivityContract,
  copyContentDraftContract,
  duplicateContentDraftContract,
  planContentDraftContract,
  recoverContentDraftRevisionContract,
  updateDraftPropertiesContract,
} from '@/lib/api/contracts/write'

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
  scheduleCampaignPostContract,
  listScheduledPostsContract,
  createScheduledPostContract,
  cancelScheduledPostContract,
  listContentDraftsContract,
  createContentDraftContract,
  getContentDraftContract,
  updateContentDraftContract,
  deleteContentDraftContract,
  listContentDraftPostsContract,
  updateDraftPropertiesContract,
  planContentDraftContract,
  duplicateContentDraftContract,
  copyContentDraftContract,
  recoverContentDraftRevisionContract,
  contentDraftActivityContract,
  listSocialSetsContract,
  createSocialSetContract,
  getSocialSetContract,
  updateSocialSetContract,
  deleteSocialSetContract,
  lookupMentionsContract,
  listDraftTagsContract,
  createDraftTagContract,
  updateDraftTagContract,
  deleteDraftTagContract,
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
