import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  matchesDestination,
  paidCapability,
  platformArea,
  platformHref,
  safeReturnPath,
  PLATFORM_DESTINATIONS,
} from '@/lib/platform/navigation'
import { SIGNED_IN_PATHS } from '@/lib/auth/sign-in-gate'
import { followsTheme, parseNavigation } from '@/lib/settings/appearance'
import {
  hasLinkNavigationGuards,
  prepareLinkNavigation,
  prepareWorkspaceSwitch,
  registerNavigationGuard,
} from '@/lib/platform/navigation-guard'
import { draftAssetNode, supportedDraftMedia } from '@/lib/platform/asset-handoff'
import { serializeDraft } from '@/lib/content-drafts/serialize'

test('canonical editors, aliases and localized routes select the owning job', () => {
  for (const [path, area] of [
    ['/?project=abc', 'create'],
    ['/?editor=app-store', 'create'],
    ['/fr/canvas/abc', 'create'],
    ['/creative-sets/abc', 'create'],
    ['/projects', 'library'],
    ['/assets', 'library'],
    ['/library?type=store', 'library'],
    ['/write/plan?set=abc', 'publish'],
    ['/de/drafts/abc', 'publish'],
    ['/link-preview', 'publish'],
    ['/campaigns/a/copy#post-a', 'campaigns'],
    ['/releases/a', 'campaigns'],
    ['/workflows/runs/a', 'automate'],
    ['/workspace/brand-kit', 'settings'],
  ] as const)
    assert.equal(platformArea(path), area, path)
  for (const path of [
    '/campaigns-unrelated',
    '/review/token',
    '/s/token',
    '/api/render',
    '/sign-in',
  ])
    assert.equal(platformArea(path), undefined)
  assert.equal(PLATFORM_DESTINATIONS.length, 8)
})

test('locale and supported return context survive without external redirects', () => {
  assert.equal(platformHref('/fr', '/home'), '/fr/home')
  assert.equal(platformHref('/fr/canvas/a', '/write?set=b#c'), '/fr/write?set=b#c')
  assert.equal(platformHref('/fr/canvas/a', '/fr/library'), '/fr/library')
  assert.equal(platformHref('/canvas/a', '/home'), '/home')
  for (const unsafe of [
    undefined,
    '',
    'https://other.test',
    '//other.test',
    '/\\other.test',
    '/x\ny',
  ])
    assert.equal(safeReturnPath(unsafe), '/home')
  assert.equal(
    safeReturnPath('/fr/workflows/a?node=b#inspector'),
    '/fr/workflows/a?node=b#inspector'
  )
  assert.equal(safeReturnPath('/?project=keep'), '/?project=keep')
})

test('new navigation is labeled and every explicit old preference survives', () => {
  assert.equal(parseNavigation(undefined), 'expanded')
  assert.equal(parseNavigation('invalid'), 'expanded')
  for (const value of ['compact', 'expanded', 'dynamic'])
    assert.equal(parseNavigation(value), value)
})

test('workspace switching waits for saves and stops before any later action on failure', async () => {
  const events: string[] = []
  const removeFirst = registerNavigationGuard(async () => {
    await Promise.resolve()
    events.push('saved')
  })
  const removeFailure = registerNavigationGuard(() => {
    throw new Error('save failed')
  })
  const removeLast = registerNavigationGuard(() => {
    events.push('switch')
  })
  try {
    await assert.rejects(prepareWorkspaceSwitch(), /save failed/)
    assert.deepEqual(events, ['saved'])
    removeFailure()
    await prepareWorkspaceSwitch()
    assert.deepEqual(events, ['saved', 'saved', 'switch'])
  } finally {
    removeFirst()
    removeFailure()
    removeLast()
  }
  await prepareWorkspaceSwitch()
})

test('library attachment keeps immutable media identity through writing serialization', () => {
  const id = 'cm123456789012345678901234'
  const image = draftAssetNode({ id, mediaType: 'image/png' })
  assert.equal(image.url, `/api/v1/assets/${id}/content`)
  assert.equal(image.type, 'img')
  assert.deepEqual(serializeDraft([image], 'linkedin').assetIds, [id])
  assert.equal(draftAssetNode({ id, mediaType: 'video/mp4' }).type, 'video')
  assert.equal(supportedDraftMedia('image/svg+xml'), false)
  assert.throws(() => draftAssetNode({ id, mediaType: 'application/pdf' }), /supported/)
  assert.throws(() => draftAssetNode({ id: '../../another-tenant', mediaType: 'image/png' }))
})

test('shell links wait only for opted-in editor saves and retain failures', async () => {
  let saved = 0
  const remove = registerNavigationGuard(() => {
    saved++
  }, true)
  const removeSwitch = registerNavigationGuard(() => {
    throw new Error('workspace-only guard')
  })
  try {
    assert.equal(hasLinkNavigationGuards(), true)
    await prepareLinkNavigation()
    assert.equal(saved, 1)
    const removeFailure = registerNavigationGuard(() => {
      throw new Error('save offline')
    }, true)
    try {
      await assert.rejects(prepareLinkNavigation(), /save offline/)
    } finally {
      removeFailure()
    }
  } finally {
    remove()
    removeSwitch()
  }
  assert.equal(hasLinkNavigationGuards(), false)
})

test('workspace and editor routes follow appearance in every locale', () => {
  for (const path of [
    '/',
    '/fr',
    '/home',
    '/fr/library',
    '/canvas/design',
    '/workflows',
    ...SIGNED_IN_PATHS,
  ]) {
    assert.equal(followsTheme(path), true, path)
  }
  for (const path of ['/landing', '/fr/landing', '/pricing', '/guides', '/sign-in']) {
    assert.equal(followsTheme(path), false, path)
  }
})

test('the plan page names the paid capability a free workspace asked for', () => {
  assert.equal(paidCapability('/create'), 'Create')
  assert.equal(paidCapability('/library?view=assets'), 'Library')
  assert.equal(paidCapability('/assets'), 'Library')
  assert.equal(paidCapability('/activity'), 'Activity')
  assert.equal(paidCapability('/workflows/new'), 'Automate')
  assert.equal(paidCapability('/'), 'The screenshot editor')
  assert.equal(paidCapability('/?editor=app-store'), 'Store screenshots')
  assert.equal(paidCapability('/canvas/new'), 'Canvas')
  assert.equal(paidCapability('/compress-image'), 'Image tools')
  // Free areas and unsafe or missing destinations name nothing.
  for (const from of ['/write', '/home', '/workspace', '//evil.test', 'https://evil.test', null])
    assert.equal(paidCapability(from), null, String(from))
})

test('destination search understands task words, not just area names', () => {
  const find = (query: string) =>
    PLATFORM_DESTINATIONS.filter((item) => matchesDestination(item.key, item.label, query)).map(
      (item) => item.key
    )
  assert.deepEqual(find('draft'), ['publish'])
  assert.deepEqual(find('drafts'), ['publish'])
  assert.deepEqual(find('Write'), ['publish'])
  assert.ok(find('screenshot').includes('create'))
  assert.deepEqual(find('billing'), ['settings'])
  assert.equal(find('').length, PLATFORM_DESTINATIONS.length)
  assert.deepEqual(find('zzz'), [])
})

test('the in-app plan page follows the theme like the rest of the app', () => {
  assert.equal(followsTheme('/upgrade'), true)
})
