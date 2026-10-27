import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  changePreferences,
  preferenceGroupState,
  preferenceSelected,
} from '../lib/notifications/preferences'
import { notificationPreferencesSchema } from '../lib/notifications/schema'

test('editing a legacy all-channel opt-out preserves the other channels and duplicate-name identities', () => {
  const saved = notificationPreferencesSchema.parse({
    generation: 1,
    events: {},
    socialSets: { first: { 'post.published': false } },
  })
  const next = changePreferences(saved, ['post.published'], 'email', true, 'first')
  assert.equal(preferenceSelected(next, 'post.published', 'email', 'first'), true)
  assert.equal(preferenceSelected(next, 'post.published', 'inApp', 'first'), false)
  assert.equal(preferenceSelected(next, 'post.published', 'slack', 'first'), false)
  assert.equal(preferenceSelected(next, 'post.published', 'inApp', 'second'), true)
  assert.equal(saved.socialSets?.first?.['post.published'], false)
  assert.deepEqual(next.socialSetChannels?.first?.['post.published'], {
    inApp: false,
    email: true,
    slack: false,
  })
})

test('group selection deterministically toggles every child in one channel', () => {
  const saved = notificationPreferencesSchema.parse({
    generation: 1,
    events: {
      first: { inApp: true, email: false, slack: false },
      second: { inApp: true, email: true, slack: false },
    },
  })
  const kinds = ['first', 'second']
  const state = preferenceGroupState(kinds.map((id) => preferenceSelected(saved, id, 'email')))
  const selectAll = state !== true
  assert.equal(state, 'indeterminate')
  const selected = changePreferences(saved, kinds, 'email', selectAll)
  assert.equal(
    preferenceGroupState(kinds.map((id) => preferenceSelected(selected, id, 'email'))),
    true
  )
  const cleared = changePreferences(selected, kinds, 'email', false)
  assert.equal(
    preferenceGroupState(kinds.map((id) => preferenceSelected(cleared, id, 'email'))),
    false
  )
  assert.equal(preferenceSelected(cleared, 'first', 'inApp'), true)
  assert.equal(preferenceSelected(cleared, 'second', 'slack'), false)
})

test('notification contract preserves omitted channels and rejects misspelled channel names', () => {
  assert.equal(
    notificationPreferencesSchema.safeParse({
      generation: 1,
      events: {},
      socialSetChannels: { first: { 'post.published': { emial: true } } },
    }).success,
    false
  )
  const value = notificationPreferencesSchema.parse({
    generation: 1,
    events: {},
    socialSetChannels: { first: { 'post.published': { email: false } } },
  })
  assert.deepEqual(value.socialSetChannels?.first?.['post.published'], { email: false })
})
