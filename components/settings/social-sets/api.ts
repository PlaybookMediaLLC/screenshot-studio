'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'
import { toast } from 'sonner'
import type { z } from 'zod'
import type { SaveResult } from '@/components/settings/PreferencesProvider'
import { socialSetListSchema, socialSetSchema, type socialSetUpdateSchema } from '@/lib/api/contracts/social-sets'
import { SettingsRequestError, settingsErrorMessage, settingsRequest } from '@/lib/settings/client'

/** A social set as the API returns it. */
export type SocialSetRecord = z.output<typeof socialSetSchema>

/** A set settings save, without the version the hook adds. */
export type SocialSetChange = Omit<z.input<typeof socialSetUpdateSchema>, 'baseVersion'>

/** The query key of the set list. */
export const SOCIAL_SETS_KEY = ['social-sets'] as const

/** The query key of one set. */
export function socialSetKey(id: string) {
  return ['social-sets', id] as const
}

/** The sets you can see, accounts in no set, and orphaned private sets. */
export function useSocialSets() {
  return useQuery({
    queryFn: () => settingsRequest('/api/v1/social-sets', socialSetListSchema),
    queryKey: SOCIAL_SETS_KEY,
  })
}

/** One set. */
export function useSocialSet(id: string) {
  return useQuery({
    queryFn: () => settingsRequest(`/api/v1/social-sets/${encodeURIComponent(id)}`, socialSetSchema),
    queryKey: socialSetKey(id),
    retry: (count, error) => !(error instanceof SettingsRequestError && error.status === 404) && count < 2,
  })
}

/**
 * Saves a set's settings one change at a time, each based on the version the
 * last save returned, so quick edits never overwrite each other. A save made
 * against a version someone else moved past reloads the set and says so.
 */
export function useSaveSocialSet(id: string): (change: SocialSetChange) => Promise<SaveResult> {
  const queryClient = useQueryClient()
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  return useCallback(
    (change: SocialSetChange) => {
      const run = queue.current.then(async (): Promise<SaveResult> => {
        const current = queryClient.getQueryData<SocialSetRecord>(socialSetKey(id))
        if (!current) return { error: 'This social set is still loading.', ok: false }
        try {
          const saved = await settingsRequest(`/api/v1/social-sets/${encodeURIComponent(id)}`, socialSetSchema, {
            body: { ...change, baseVersion: current.version },
            method: 'PATCH',
          })
          queryClient.setQueryData(socialSetKey(id), saved)
          await queryClient.invalidateQueries({ exact: true, queryKey: SOCIAL_SETS_KEY })
          return { ok: true }
        } catch (error) {
          if (error instanceof SettingsRequestError && error.status === 409) {
            await queryClient.invalidateQueries({ queryKey: socialSetKey(id) })
            toast.info('Someone else changed this social set. Showing the latest version.')
          }
          return { error: settingsErrorMessage(error), ok: false }
        }
      })
      queue.current = run.catch(() => undefined)
      return run
    },
    [id, queryClient]
  )
}

/** Puts a fresh set into the cache after an action that returns one. */
export function useStoreSocialSet() {
  const queryClient = useQueryClient()
  return useCallback(
    async (set: SocialSetRecord) => {
      queryClient.setQueryData(socialSetKey(set.id), set)
      await queryClient.invalidateQueries({ exact: true, queryKey: SOCIAL_SETS_KEY })
    },
    [queryClient]
  )
}

/** Where to send someone to connect an account on a platform to a set. */
export function connectHref(provider: string, socialSetId: string): string {
  return `/integrations/social/${encodeURIComponent(provider)}/start?socialSet=${encodeURIComponent(socialSetId)}`
}

/** The OAuth providers a set can connect from settings, by label. */
export const CONNECT_PROVIDERS = [
  { label: 'X', platform: 'x', provider: 'x' },
  { label: 'LinkedIn', platform: 'linkedin', provider: 'linkedin' },
  { label: 'Instagram', platform: 'instagram-standalone', provider: 'instagram-standalone' },
  { label: 'Threads', platform: 'threads', provider: 'threads' },
  { label: 'Mastodon', platform: 'mastodon', provider: 'mastodon' },
] as const

/** What to tell someone about an account that is not connected. */
export const HEALTH_GUIDANCE: Record<SocialSetRecord['accounts'][number]['health'], string> = {
  connected: 'Connected and ready to publish.',
  unverified: 'The account’s credentials could not be verified. Reconnect it before publishing.',
  expired: "The account's access expired. Reconnect it to publish again.",
  permission_required: 'The platform needs one more step, such as choosing a page. Reconnect to finish it.',
  reconnect_required: 'The platform asked for this account to be connected again. Reconnect it to keep publishing.',
  removed: 'This account was removed from the set and cannot publish.',
  revoked: 'Access was revoked on the platform. Reconnect it, or remove it from this set.',
}

/** The provider a connected platform reconnects through. */
export function providerFor(platform: string): string | null {
  return CONNECT_PROVIDERS.find((provider) => provider.platform === platform)?.provider ?? (platform === 'instagram' ? 'instagram' : null)
}
