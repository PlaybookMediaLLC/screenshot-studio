import { getPreferenceValues, LocalStorage } from '@raycast/api'
import { createHash, randomUUID } from 'node:crypto'
import { ShotsClient } from './client'

export function client() { const p = getPreferenceValues<{baseUrl:string;apiKey:string}>(); return new ShotsClient(p.baseUrl, p.apiKey) }
// Preferences follow the deployment and key, so a workspace switch cannot reuse another set.
function preferenceKey() { const p = getPreferenceValues<{baseUrl:string;apiKey:string}>(); return `shots:${createHash('sha256').update(p.baseUrl + ':' + p.apiKey).digest('hex')}` }
export async function remembered() { const value = await LocalStorage.getItem<string>(preferenceKey()); if (!value) return null; try { return JSON.parse(value) as {set:string;platforms:string[]} } catch { return null } }
export async function remember(set: string, platforms: string[]) { await LocalStorage.setItem(preferenceKey(), JSON.stringify({set, platforms})) }

/** Persist the creation receipt before the network request; a restarted command can retry it. */
export async function creationRequest(signature: string): Promise<string> {
  const key = `${preferenceKey()}:create:${createHash('sha256').update(signature).digest('hex')}`
  const prior = await LocalStorage.getItem<string>(key)
  if (prior) return prior
  const id = randomUUID()
  await LocalStorage.setItem(key, id)
  return id
}
/** Clear only a confirmed receipt. Uncertain responses retain the same server import key. */
export async function confirmCreation(signature: string) {
  const key = `${preferenceKey()}:create:${createHash('sha256').update(signature).digest('hex')}`
  await LocalStorage.removeItem(key)
}
