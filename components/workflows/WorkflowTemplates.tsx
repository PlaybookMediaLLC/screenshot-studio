'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ButtonLink } from '@/components/platform-shell/ButtonLink'
import { Group, Pill, Row, Section } from '@/components/platform-ui'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getErrorMessage } from '@/components/workspace/settings-client'
import type { AutomationOverview } from '@/lib/api/contracts/release-automation'
import { useTRPCClient } from '@/lib/trpc/react'
import { actionAvailability } from '@/lib/workflows/actions'
import {
  buildWorkflowTemplate,
  WORKFLOW_TEMPLATES,
  type WorkflowTemplateId,
} from '@/lib/workflows/templates'

const EMPTY = '__empty_option__'

/** Pick an executable template, fill in workspace resources, and open it as a draft. */
export function WorkflowTemplates() {
  const client = useTRPCClient()
  const router = useRouter()
  const [overview, setOverview] = useState<AutomationOverview | null>(null)
  const [templateId, setTemplateId] = useState<WorkflowTemplateId | null>(null)
  const [sourceId, setSourceId] = useState('')
  const [name, setName] = useState('')
  const [brandKitId, setBrandKitId] = useState('')
  const [destinationIds, setDestinationIds] = useState<string[]>([])
  const [branch, setBranch] = useState('main')
  const [generate, setGenerate] = useState(false)
  const [creditLimit, setCreditLimit] = useState(25)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    client.releaseAutomation.overview
      .query()
      .then((next) => {
        setOverview(next)
        setBrandKitId(next.brands[0]?.id ?? '')
        setDestinationIds(next.destinations[0] ? [next.destinations[0].id] : [])
        setGenerate(actionAvailability(next, 'generate_copy').available)
        const source = next.sources.find((item) => item.connectionState === 'connected')
        setSourceId(source?.id ?? '')
        setBranch(source?.branch || 'main')
      })
      .catch((failure) => setError(getErrorMessage(failure)))
  }, [client])

  if (!overview) {
    return error ? (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    ) : (
      <p className="text-sm text-neutral-500" role="status">
        Loading templates…
      </p>
    )
  }

  const sources = overview.sources.filter((source) => source.connectionState === 'connected')
  const template = WORKFLOW_TEMPLATES.find((candidate) => candidate.id === templateId)
  const generation = actionAvailability(overview, 'generate_copy')

  async function create() {
    if (!template) return
    setBusy(true)
    setError(null)
    try {
      const { graph, layout } = buildWorkflowTemplate(template.id, {
        brandKitId,
        destinationIds,
        creditLimit: generate ? creditLimit : 0,
        branch: branch.trim() || 'main',
      })
      const saved = await client.releaseAutomation.save.mutate({
        id: '',
        sourceAppId: sourceId,
        name: name.trim() || template.name,
        description: template.description,
        priority: 100,
        expectedRevision: 0,
        graph,
        layout,
      })
      router.push(`/workflows/${saved.id}`)
    } catch (failure) {
      setError(getErrorMessage(failure))
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <Section
        description="Each template is a normal, editable workflow."
        title="Choose a template"
      >
        <ul className="grid gap-3">
          {WORKFLOW_TEMPLATES.map((candidate) => (
            <li key={candidate.id}>
              <Button
                aria-pressed={candidate.id === templateId}
                className="flex h-auto w-full flex-col items-start gap-2 rounded-xl p-5 text-left whitespace-normal aria-pressed:ring-2 aria-pressed:ring-emerald-500/60"
                onClick={() => {
                  setTemplateId(candidate.id)
                  setName(candidate.name)
                }}
                type="button"
                variant="outline"
              >
                <span className="text-sm font-medium text-white">{candidate.name}</span>
                <span className="text-sm font-normal text-neutral-400">
                  {candidate.description}
                </span>
                <span className="text-xs font-normal text-neutral-500">
                  {candidate.steps.join(' → ')}
                </span>
              </Button>
            </li>
          ))}
          <li className="flex flex-col gap-2 rounded-xl p-5 ring-1 ring-white/[0.08]">
            <span className="text-sm font-medium text-white">Manual campaign</span>
            <span className="text-sm text-neutral-400">
              Pick a release you already shipped and build its campaign by hand, with the same
              review rules.
            </span>
            <Link className="self-start text-sm underline" href="/campaigns/new">
              Start a manual campaign
            </Link>
          </li>
          <li
            aria-disabled
            className="flex flex-col gap-2 rounded-xl p-5 opacity-60 ring-1 ring-white/[0.08]"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-white">
              Weekly recurring campaign <Pill>Planned</Pill>
            </span>
            <span className="text-sm text-neutral-400">
              Scheduled generation with period deduplication (RFC 029) is not built yet, so it
              cannot be activated.
            </span>
          </li>
        </ul>
      </Section>

      {template ? (
        <Section
          description="You can change every step in the editor before activating."
          title="Configure"
        >
          {sources.length === 0 ? (
            <Alert>
              <AlertDescription>
                Connect GitHub and watch a repository on the{' '}
                <Link className="underline" href="/workflows#sources">
                  Workflows page
                </Link>{' '}
                first.
              </AlertDescription>
            </Alert>
          ) : (
            <Group>
              <Row label="Name">
                <Input
                  aria-label="Workflow name"
                  onChange={(event) => setName(event.target.value)}
                  value={name}
                />
              </Row>
              <Row description="Workflows run for one watched repository." label="Repository">
                <Select
                  onValueChange={(next) => setSourceId(next === EMPTY ? '' : next)}
                  value={sourceId || EMPTY}
                >
                  <SelectTrigger aria-label="Repository" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={EMPTY}>Choose a repository</SelectItem>
                    {sources.map((source) => (
                      <SelectItem key={source.id} value={source.id}>
                        {source.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
              {template.id === 'feature-announcement' ? (
                <Row
                  description="Only pull requests merged into this branch qualify."
                  label="Branch"
                >
                  <Input
                    aria-label="Pull request base branch"
                    onChange={(event) => setBranch(event.target.value)}
                    value={branch}
                  />
                </Row>
              ) : null}
              <Row description="Drafts use this published brand kit." label="Brand kit">
                <Select
                  onValueChange={(next) => setBrandKitId(next === EMPTY ? '' : next)}
                  value={brandKitId || EMPTY}
                >
                  <SelectTrigger aria-label="Brand kit" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={EMPTY}>Select a published brand kit</SelectItem>
                    {overview.brands.map((brand) => (
                      <SelectItem key={brand.id} value={brand.id}>
                        {brand.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
              <Row
                description="One draft post per destination."
                label="Destinations"
                layout="stacked"
              >
                {overview.destinations.length === 0 ? (
                  <p className="text-sm text-neutral-500">
                    Connect a destination in{' '}
                    <Link className="underline" href="/workspace/channels">
                      Channels
                    </Link>{' '}
                    first.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-4">
                    {overview.destinations.map((destination) => (
                      <Label className="flex items-center gap-2 text-sm" key={destination.id}>
                        <Checkbox
                          checked={destinationIds.includes(destination.id)}
                          onCheckedChange={(checked) =>
                            setDestinationIds(
                              checked === true
                                ? [...destinationIds, destination.id]
                                : destinationIds.filter((id) => id !== destination.id)
                            )
                          }
                        />
                        {destination.name}
                      </Label>
                    ))}
                  </div>
                )}
              </Row>
              <Row
                description={
                  generation.available
                    ? 'Rewrites each draft for its channel in your brand voice. Spends AI credits, at most the limit, once per run.'
                    : `Unavailable: ${generation.reason}`
                }
                label="AI channel copy"
                layout="stacked"
              >
                <div className="flex flex-wrap items-center gap-4">
                  <Label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={generate}
                      disabled={!generation.available}
                      onCheckedChange={(checked) => setGenerate(checked === true)}
                    />
                    Generate copy with AI
                  </Label>
                  {generate ? (
                    <Label className="flex items-center gap-2 text-sm">
                      Credit limit
                      <Input
                        className="w-24"
                        max={500}
                        min={1}
                        onChange={(event) =>
                          setCreditLimit(Math.trunc(Number(event.target.value)) || 1)
                        }
                        type="number"
                        value={creditLimit}
                      />
                    </Label>
                  ) : null}
                </div>
              </Row>
              <Row>
                <div className="flex flex-wrap items-center gap-3">
                  <Button disabled={busy || !sourceId} onClick={() => void create()} type="button">
                    {busy ? 'Creating…' : 'Create draft'}
                  </Button>
                  <ButtonLink href="/workflows" variant="ghost">
                    Cancel
                  </ButtonLink>
                  <span className="text-xs text-neutral-500">
                    The draft is validated by the backend; nothing runs until you activate it.
                  </span>
                </div>
              </Row>
            </Group>
          )}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </Section>
      ) : null}
    </div>
  )
}
