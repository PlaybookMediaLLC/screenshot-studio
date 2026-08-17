import assert from 'node:assert/strict'
import test from 'node:test'
import { campaignPostTransitions, canTransitionCampaignPost } from '@/lib/tenant/campaign-status'

test('submission moves drafts and change requests into review', () => {
  assert.equal(canTransitionCampaignPost('submit', 'DRAFT'), true)
  assert.equal(canTransitionCampaignPost('submit', 'NEEDS_CHANGES'), true)
  assert.equal(canTransitionCampaignPost('submit', 'REJECTED'), false)
  assert.equal(canTransitionCampaignPost('submit', 'APPROVED'), false)
  assert.equal(campaignPostTransitions.submit.to, 'READY_FOR_REVIEW')
})

test('review decisions apply only to posts in review', () => {
  for (const decision of ['approve', 'reject', 'request_changes'] as const) {
    assert.equal(canTransitionCampaignPost(decision, 'READY_FOR_REVIEW'), true)
    assert.equal(canTransitionCampaignPost(decision, 'DRAFT'), false)
    assert.equal(canTransitionCampaignPost(decision, 'SCHEDULED'), false)
    assert.equal(canTransitionCampaignPost(decision, 'PUBLISHED'), false)
  }
  assert.equal(campaignPostTransitions.approve.to, 'APPROVED')
  assert.equal(campaignPostTransitions.reject.to, 'REJECTED')
  assert.equal(campaignPostTransitions.request_changes.to, 'NEEDS_CHANGES')
})

test('review decisions require the approver permission', () => {
  assert.equal(campaignPostTransitions.submit.permission, 'release:create')
  assert.equal(campaignPostTransitions.approve.permission, 'release:approve')
  assert.equal(campaignPostTransitions.reject.permission, 'release:approve')
  assert.equal(campaignPostTransitions.request_changes.permission, 'release:approve')
})
