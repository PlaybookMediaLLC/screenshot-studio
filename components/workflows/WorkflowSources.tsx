'use client'

import { useState } from 'react'
import { Group, Pill, Row, Section } from '@/components/platform-ui'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { GitHubConnections } from '@/components/workspace/GitHubConnections'
import type { AutomationOverview } from '@/lib/api/contracts/release-automation'
import { useTRPCClient } from '@/lib/trpc/react'

type Source = AutomationOverview['sources'][number]

const CONNECTION_LABELS: Record<string, string> = {
  connected: 'Connected',
  disconnected: 'Installation unlinked from this workspace',
  deleted: 'GitHub App uninstalled',
  suspended: 'Installation suspended in GitHub',
  repository_access_removed: 'Repository access removed or no longer watched',
}

/**
 * Event sources: GitHub connections, watched repositories, their branch, and
 * the sticky automation mode. Every change is an owner/admin session action.
 */
export function WorkflowSources({
  canManage,
  overview,
  perform,
  busy,
}: {
  canManage: boolean
  overview: AutomationOverview
  perform: (action: () => Promise<unknown>) => void
  busy: boolean
}) {
  return (
    <div className="flex flex-col gap-8" id="sources">
      {canManage ? (
        <GitHubConnections />
      ) : (
        <p className="text-sm text-muted-foreground">
          An owner or administrator connects GitHub and chooses repositories.
        </p>
      )}
      <Section
        description="Once a workflow is active, workflows handle this repository's merged changes. Pausing them does not send changes back to manual release intake."
        title="Watched repositories"
      >
        <Group>
          {overview.sources.length === 0 ? (
            <Row>
              <p className="text-sm text-muted-foreground">
                Connect GitHub and watch a repository to start.
              </p>
            </Row>
          ) : (
            overview.sources.map((source) => (
              <SourceRow
                busy={busy}
                canManage={canManage}
                key={source.id}
                perform={perform}
                source={source}
              />
            ))
          )}
        </Group>
      </Section>
    </div>
  )
}

function SourceRow({
  busy,
  canManage,
  perform,
  source,
}: {
  busy: boolean
  canManage: boolean
  perform: (action: () => Promise<unknown>) => void
  source: Source
}) {
  const client = useTRPCClient()
  const [branch, setBranch] = useState(source.branch ?? '')
  const connected = source.connectionState === 'connected'
  const mode = (enabled: boolean, extra: { collectUnmatched?: boolean; branch?: string } = {}) =>
    perform(() => client.releaseAutomation.sourceMode.mutate({ id: source.id, enabled, ...extra }))
  return (
    <Row
      description={`${source.account || 'GitHub'} · ${source.mode} mode · ${
        source.branch ? `PRs into ${source.branch}` : 'PRs into the default branch'
      }`}
      label={
        <span className="flex flex-wrap items-center gap-2">
          {source.name}
          <Pill tone={connected ? 'green' : 'yellow'}>
            {CONNECTION_LABELS[source.connectionState] ?? source.connectionState}
          </Pill>
        </span>
      }
      layout="stacked"
    >
      {!connected ? (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          Restore access in GitHub, reconnect the installation above, and watch this repository
          again. Runs cancelled by the outage stay cancelled; history is kept.
        </p>
      ) : null}
      {canManage && connected ? (
        <div className="flex w-full flex-wrap items-end gap-3">
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              mode(source.mode === 'automation', { branch: branch.trim() })
            }}
          >
            <Label className="grid gap-1 text-xs text-muted-foreground">
              Watched branch
              <Input
                aria-label={`Watched branch for ${source.name}`}
                className="h-9 w-40"
                onChange={(event) => setBranch(event.target.value)}
                placeholder="Default branch"
                value={branch}
              />
            </Label>
            <Button
              disabled={busy || branch === (source.branch ?? '')}
              size="sm"
              type="submit"
              variant="outline"
            >
              Save branch
            </Button>
          </form>
          <Label className="grid gap-1 text-xs text-muted-foreground">
            Unmatched merged PRs
            <Select
              disabled={busy}
              value={source.collectUnmatched ? 'collect' : 'skip'}
              onValueChange={(nextValue) =>
                mode(source.mode === 'automation', { collectUnmatched: nextValue === 'collect' })
              }
            >
              <SelectTrigger
                aria-label={`Unmatched merged PRs for ${source.name}`}
                className="h-9 w-56"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="collect">Hold as source changes</SelectItem>
                <SelectItem value="skip">Skip without collecting</SelectItem>
              </SelectContent>
            </Select>
          </Label>
          <Button
            disabled={busy}
            onClick={() => mode(source.mode !== 'automation')}
            size="sm"
            type="button"
            variant="outline"
          >
            {source.mode === 'automation'
              ? 'Return to manual release intake'
              : 'Let workflows handle releases'}
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              window.confirm(`Stop watching ${source.name}? Pending runs will be cancelled.`) &&
              perform(() => client.releaseAutomation.disconnectSource.mutate({ id: source.id }))
            }
            size="sm"
            type="button"
            variant="destructive"
          >
            Stop watching {source.name}
          </Button>
        </div>
      ) : null}
    </Row>
  )
}
