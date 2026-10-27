import assert from 'node:assert/strict'
import test from 'node:test'
import {
  campaignPostTransitions,
  canTransitionCampaignPost,
  getCampaignTransitionPermission,
} from '@/lib/tenant/campaign-status'

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

test('campaigns start in draft and move to review, approval, and archive explicitly', () => {
  assert.equal(getCampaignTransitionPermission('DRAFT', 'READY_FOR_REVIEW'), 'release:create')
  assert.equal(getCampaignTransitionPermission('READY_FOR_REVIEW', 'APPROVED'), 'release:approve')
  assert.equal(getCampaignTransitionPermission('READY_FOR_REVIEW', 'DRAFT'), 'release:create')
  assert.equal(getCampaignTransitionPermission('APPROVED', 'ARCHIVED'), 'release:create')
  assert.equal(getCampaignTransitionPermission('ARCHIVED', 'DRAFT'), 'release:create')
})

test('campaigns cannot skip review or leave archive except back to draft', () => {
  assert.equal(getCampaignTransitionPermission('DRAFT', 'APPROVED'), null)
  assert.equal(getCampaignTransitionPermission('DRAFT', 'DRAFT'), null)
  assert.equal(getCampaignTransitionPermission('ARCHIVED', 'APPROVED'), null)
  assert.equal(getCampaignTransitionPermission('ARCHIVED', 'READY_FOR_REVIEW'), null)
})
