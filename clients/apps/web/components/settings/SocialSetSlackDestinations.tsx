'use client'

import { useSocialSets } from '@/components/settings/social-sets/api'
import type { NotificationSettings } from '@/lib/notifications/schema'

/** Override the shared Slack channel for each workspace-visible publishing brand. */
export function SocialSetSlackDestinations({policy,channels,disabled,onChange}:{
  policy:NotificationSettings['policy']
  channels: Array<{id:string;name:string;isMember:boolean;isArchived:boolean}>
  disabled:boolean
  onChange:(policy:NotificationSettings['policy'])=>void
}) {
  const sets=useSocialSets()
  if (sets.isError) return <p role="alert">Publishing brands could not be loaded. Reload to change brand destinations.</p>
  if (sets.isPending) return <p role="status">Loading publishing brands…</p>
  const shared=sets.data.items.filter((set) => set.visibility==='WORKSPACE')
  if (!shared.length) return null
  return <fieldset disabled={disabled} className="grid gap-3 border-t pt-4">
    <legend className="text-sm font-medium">Channel by publishing brand</legend>
    <p className="text-xs text-muted-foreground">Use the workspace channel, pick a channel in the connected Slack workspace, or turn shared-channel notices off. Private brands never send to shared channels.</p>
    {shared.map((set) => <label key={set.id} className="grid gap-1 text-sm">
      {set.name}
      <select className="rounded border bg-background p-2" aria-label={`Slack channel for ${set.name}`} value={policy.socialSetSlackChannels?.[set.id]?.channelId ?? '__inherit'} onChange={(event) => {
        const next={...policy.socialSetSlackChannels}
        if(event.target.value==='__inherit') delete next[set.id]
        else next[set.id]={channelId:event.target.value,channelName:''}
        onChange({...policy,socialSetSlackChannels:next})
      }}>
        <option value="__inherit">Workspace channel</option>
        <option value="">No shared-channel notices</option>
        {channels.map((channel) => <option key={channel.id} value={channel.id} disabled={!channel.isMember || channel.isArchived}>#{channel.name}{!channel.isMember?' — invite the app first':''}</option>)}
      </select>
    </label>)}
  </fieldset>
}
