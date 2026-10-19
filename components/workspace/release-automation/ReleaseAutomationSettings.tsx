'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import type {
  AutomationDefinition,
  AutomationFamily,
  AutomationHistoryItem,
  AutomationOverview,
  AutomationRunDetail,
} from 'screenshot-studio-backend-sdk'
import { Button } from '@/components/ui/button'
import { useTRPCClient } from '@/lib/trpc/react'
import { initialReleaseLayout, initialReleaseWorkflow } from '@/lib/release-automation/examples'
import { GitHubConnections } from '../GitHubConnections'
import { getErrorMessage } from '../settings-client'
import { automationSelectClass } from './ConditionEditor'
import { WorkflowEditor } from './WorkflowEditor'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'

/** Workspace-scoped definitions, source controls, and durable execution history. */
export function ReleaseAutomationSettings({ canManage }: { canManage: boolean }) {
  const client = useTRPCClient()
  const [overview, setOverview] = useState<AutomationOverview | null>(null)
  const [history, setHistory] = useState<AutomationHistoryItem[]>([])
  const [before, setBefore] = useState<string | undefined>()
  const [editor, setEditor] = useState<AutomationDefinition | null>(null)
  const [detail, setDetail] = useState<AutomationRunDetail | null>(null)
  const [sourceId, setSourceId] = useState('')
  const [family, setFamily] = useState<AutomationFamily>('release.published')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try {
      const [next, recent] = await Promise.all([
        client.releaseAutomation.overview.query(),
        client.releaseAutomation.history.query({ before }),
      ])
      setOverview(next)
      setHistory(recent.items)
    } catch (failure) {
      setError(getErrorMessage(failure))
    }
  }, [client, before])
  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 10_000)
    return () => clearInterval(timer)
  }, [load])
  useEffect(() => {
    if (!detail || !['accepted', 'running', 'queued'].includes(detail.run.status)) return
    const timer = setInterval(() => {
      void client.releaseAutomation.run
        .query({ id: detail.run.id })
        .then(setDetail)
        .catch((failure) => setError(getErrorMessage(failure)))
    }, 5_000)
    return () => clearInterval(timer)
  }, [client, detail])

  async function perform(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await load()
    } catch (failure) {
      setError(getErrorMessage(failure))
    } finally {
      setBusy(false)
    }
  }
  function create() {
    if (!overview || !sourceId) return
    const template = initialReleaseWorkflow(
      family,
      overview.brands[0]?.id,
      overview.destinations[0]?.id
    )
    setEditor({
      id: '',
      sourceAppId: sourceId,
      name: 'Release announcement',
      description: '',
      priority: 100,
      activePriority: 100,
      revision: 0,
      enabled: false,
      activeVersionId: null,
      draft: template,
      layout: initialReleaseLayout,
      modifiedBy: '',
      updatedAt: '',
      issues: [],
    })
  }

  return (
    <div className="space-y-8">
      <p className="text-sm text-muted-foreground">
        Turn repository events into release and campaign drafts, then send them for human review.
        Each accepted event keeps its selected workflow versions and execution history.
      </p>
      {canManage ? (
        <GitHubConnections />
      ) : (
        <p className="text-sm">
          An owner or administrator manages GitHub connections and workflows.
        </p>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {!overview ? (
        <p role="status">Loading release automation…</p>
      ) : (
        <>
          <section aria-label="Repository automation modes" className="space-y-3">
            <h2 className="text-lg font-semibold">Repositories</h2>
            <p className="text-sm text-muted-foreground">
              Activation switches a repository to automation mode. Disabling every workflow leaves
              it in automation mode; new unmatched events do not fall back to legacy release intake.
            </p>
            {!overview.sources.length ? (
              <p className="text-sm">Connect GitHub and watch a repository above to start.</p>
            ) : (
              overview.sources.map((source) => (
                <div
                  key={source.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
                >
                  <div>
                    <p className="font-medium">{source.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {source.account} ·{' '}
                      {source.connectionState === 'repository_access_removed'
                        ? 'Repository access removed or no longer watched'
                        : source.connectionState.replaceAll('_', ' ')}{' '}
                      · {source.mode} mode
                    </p>
                    {source.status !== 'ACTIVE' || source.installationStatus !== 'ACTIVE' ? (
                      <p className="text-sm text-amber-600">
                        Restore repository access in GitHub, reconnect the installation, and watch
                        this repository again. History is retained.
                      </p>
                    ) : null}
                  </div>
                  {canManage && source.connectionState === 'connected' ? (
                    <Label className="grid gap-1 text-sm">
                      Unmatched merged PRs
                      <Select
                        disabled={busy}
                        value={source.collectUnmatched ? 'collect' : 'skip'}
                        onValueChange={(nextValue) =>
                          void perform(async () => {
                            await client.releaseAutomation.sourceMode.mutate({
                              id: source.id,
                              enabled: source.mode === 'automation',
                              collectUnmatched: nextValue === 'collect',
                            })
                          })
                        }
                      >
                        <SelectTrigger className={automationSelectClass}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="collect">Hold as source changes</SelectItem>
                          <SelectItem value="skip">Skip without collecting</SelectItem>
                        </SelectContent>
                      </Select>
                    </Label>
                  ) : null}
                  {canManage &&
                  source.status === 'ACTIVE' &&
                  source.installationStatus === 'ACTIVE' ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await client.releaseAutomation.sourceMode.mutate({
                            id: source.id,
                            enabled: source.mode !== 'automation',
                          })
                        })
                      }
                    >
                      {source.mode === 'automation'
                        ? 'Switch to legacy intake'
                        : 'Use automation mode'}
                    </Button>
                  ) : null}
                  {canManage && source.status === 'ACTIVE' ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await client.releaseAutomation.disconnectSource.mutate({ id: source.id })
                        })
                      }
                    >
                      Stop watching {source.name}
                    </Button>
                  ) : null}
                </div>
              ))
            )}
          </section>
          <section aria-label="Release workflows" className="space-y-3">
            <h2 className="text-lg font-semibold">Workflows</h2>
            {!overview.executorAvailable ? (
              <p role="status" className="text-sm text-amber-600">
                No compatible worker is available. Drafts and previews remain available. Activation
                is blocked.
              </p>
            ) : null}
            {canManage ? (
              <div className="flex flex-wrap items-end gap-3">
                <Label className="grid flex-1 gap-1 text-sm">
                  Repository
                  <Select
                    value={String(sourceId) || '__empty_option__'}
                    onValueChange={(nextValue) =>
                      setSourceId(nextValue === '__empty_option__' ? '' : nextValue)
                    }
                  >
                    <SelectTrigger className={automationSelectClass}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={'__empty_option__'}>Choose a repository</SelectItem>
                      {overview.sources
                        .filter(
                          (source) =>
                            source.status === 'ACTIVE' && source.installationStatus === 'ACTIVE'
                        )
                        .map((source) => (
                          <SelectItem key={source.id} value={source.id}>
                            {source.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </Label>
                <Label className="grid flex-1 gap-1 text-sm">
                  Event family
                  <Select
                    value={family}
                    onValueChange={(nextValue) => setFamily(nextValue as AutomationFamily)}
                  >
                    <SelectTrigger className={automationSelectClass}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="release.published">Published release</SelectItem>
                      <SelectItem value="pull_request.merged">Merged pull request</SelectItem>
                      <SelectItem value="deployment.succeeded">Successful deployment</SelectItem>
                    </SelectContent>
                  </Select>
                </Label>
                <Button type="button" disabled={!sourceId} onClick={create}>
                  Create workflow
                </Button>
              </div>
            ) : null}
            {!overview.definitions.length ? (
              <p className="text-sm text-muted-foreground">
                No workflows yet. Start with a release-to-review template.
              </p>
            ) : (
              overview.definitions.map((definition) => (
                <div
                  key={definition.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
                >
                  <div>
                    <p className="font-medium">{definition.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {
                        overview.sources.find((source) => source.id === definition.sourceAppId)
                          ?.name
                      }{' '}
                      · {definition.draft.family} ·{' '}
                      {definition.enabled
                        ? `active priority ${definition.activePriority}`
                        : definition.activeVersionId
                          ? 'disabled'
                          : 'draft'}{' '}
                      · draft {definition.revision} (priority {definition.priority})
                    </p>
                  </div>
                  {canManage ? (
                    <Button type="button" variant="outline" onClick={() => setEditor(definition)}>
                      Edit {definition.name}
                    </Button>
                  ) : null}
                </div>
              ))
            )}
          </section>
          {editor && canManage ? (
            <WorkflowEditor
              key={editor.id || `new-${editor.sourceAppId}-${editor.draft.family}`}
              definition={editor}
              overview={overview}
              history={history}
              onClose={() => setEditor(null)}
              onSaved={() => void load()}
            />
          ) : null}
        </>
      )}
      <section aria-label="Release automation history" className="space-y-3">
        <h2 className="text-lg font-semibold">Event and run history</h2>
        <p className="text-sm text-muted-foreground">
          Recorded events include skipped and failed runs. Duplicate deliveries share the same
          source event and outputs.
        </p>
        {!history.length ? (
          <p className="text-sm">No events recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="w-full text-left text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-normal p-2">Event</TableHead>
                  <TableHead className="whitespace-normal p-2">Outcome</TableHead>
                  <TableHead className="whitespace-normal p-2">Received</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((item) => (
                  <TableRow key={item.run.id} className="border-t border-border">
                    <TableCell className="whitespace-normal p-2">
                      <Button variant="custom" size={null}
                        type="button"
                        className="text-left underline"
                        onClick={() =>
                          void perform(async () =>
                            setDetail(await client.releaseAutomation.run.query({ id: item.run.id }))
                          )
                        }
                      >
                        {item.event.snapshot.title || item.event.snapshot.semanticKey}
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        {item.event.snapshot.repositoryName} · {item.event.snapshot.family}
                      </p>
                    </TableCell>
                    <TableCell className="whitespace-normal p-2">
                      {item.run.status}
                      <p className="text-xs text-muted-foreground">
                        {item.run.reason || item.event.reason}
                      </p>
                    </TableCell>
                    <TableCell className="whitespace-normal p-2">{new Date(item.event.receivedAt).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="flex gap-2">
          {before ? (
            <Button variant="outline" onClick={() => setBefore(undefined)}>
              Latest events
            </Button>
          ) : null}
          {history.length === 50 ? (
            <Button variant="outline" onClick={() => setBefore(history.at(-1)?.run.id)}>
              Older events
            </Button>
          ) : null}
        </div>
        {detail ? (
          <div aria-label="Run details" className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex justify-between gap-3">
              <h3 className="font-medium">{detail.event.snapshot.title}</h3>
              <Button variant="ghost" size="sm" onClick={() => setDetail(null)}>
                Close history detail
              </Button>
            </div>
            <p className="text-sm">
              {detail.run.status}: {detail.run.reason || detail.event.reason}
            </p>
            <dl className="grid gap-1 break-all text-xs text-muted-foreground">
              <div>Source event: {detail.event.snapshot.semanticKey}</div>
              <div>Delivery: {detail.event.deliveryId}</div>
              <div>Occurred: {new Date(detail.event.snapshot.occurredAt).toLocaleString()}</div>
              <div>Received: {new Date(detail.event.receivedAt).toLocaleString()}</div>
              <div>Origin: {detail.event.snapshot.origin}</div>
              <div>Run: {detail.run.id}</div>
              <div>Selected version: {detail.run.versionId ?? 'None'}</div>
              <div>Accepted versions: {detail.event.versionIds.join(', ') || 'None'}</div>
              <div>Recovery attempt: {detail.run.recoveryAttempt}</div>
              {detail.run.failureCode ? <div>Failure: {detail.run.failureCode}</div> : null}
            </dl>
            <div className="flex gap-3 text-sm">
              {detail.run.outputs.releaseId ? (
                <Link className="underline" href={`/releases/${detail.run.outputs.releaseId}`}>
                  Open release
                </Link>
              ) : null}
              {detail.run.outputs.campaignId ? (
                <Link
                  className="underline"
                  href={`/campaigns/${detail.run.outputs.campaignId}/copy`}
                >
                  Open campaign drafts
                </Link>
              ) : null}
            </div>
            <ol className="space-y-2">
              {detail.nodes.map((node) => (
                <li key={node.nodeId} className="rounded border border-border p-2 text-sm">
                  <p>
                    {node.nodeId} · {node.status} · {node.attempts} attempt(s)
                  </p>
                  {node.decision.status ? (
                    <p>
                      {node.decision.status}: {node.decision.reason}
                    </p>
                  ) : null}
                  {node.failureCode ? <p>{node.failureCode}</p> : null}
                  <p className="break-all text-xs text-muted-foreground">
                    {node.outputs.releaseId ? `Release ${node.outputs.releaseId} ` : ''}
                    {node.outputs.campaignId ? `Campaign ${node.outputs.campaignId} ` : ''}
                    {node.outputs.postIds?.length
                      ? `${node.outputs.postIds.length} draft posts`
                      : ''}
                  </p>
                </li>
              ))}
            </ol>
            {canManage ? (
              <div className="flex gap-2">
                {['accepted', 'running', 'queued'].includes(detail.run.status) &&
                !detail.run.cancelRequested ? (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await client.releaseAutomation.cancel.mutate({ id: detail.run.id })
                        setDetail(await client.releaseAutomation.run.query({ id: detail.run.id }))
                      })
                    }
                  >
                    Cancel run
                  </Button>
                ) : null}
                {detail.run.status === 'failed' &&
                detail.run.failureCode === 'activity_failed' &&
                !detail.run.cancelRequested ? (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await client.releaseAutomation.retry.mutate({ id: detail.run.id })
                        setDetail(await client.releaseAutomation.run.query({ id: detail.run.id }))
                      })
                    }
                  >
                    Retry failed run
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  )
}
