'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { Group, Pill, Row, Section } from '@/components/platform-ui'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useTRPCClient } from '@/lib/trpc/react'
import { getErrorMessage } from './settings-client'

type BrandKitSummary = { id: string; name: string; status: string; version: number }

/** The stored BrandProfile; the list and handle fields are JSON columns. */
type BrandProfile = {
  audience: string
  ctaConventions: string | null
  preferredStyles: unknown
  productDescription: string
  prohibitedTerms: unknown
  socialHandles: unknown
  tagline: string | null
  tone: string
}

type WorkspaceBrandSettingsProps = { canManage: boolean }

export function WorkspaceBrandSettings({ canManage }: WorkspaceBrandSettingsProps) {
  const trpcClient = useTRPCClient()
  const [brandKits, setBrandKits] = useState<BrandKitSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    trpcClient.brandKit.list
      .query()
      .then((result) => setBrandKits(result.brandKits))
      .catch((requestError) => setError(getErrorMessage(requestError)))
  }, [trpcClient])

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    const form = event.currentTarget
    const data = Object.fromEntries(new FormData(form))
    setIsSaving(true)
    try {
      await trpcClient.brandKit.create.mutate({
        definition: {
          colors: {
            accent: String(data.accent ?? ''),
            background: String(data.background ?? ''),
            foreground: String(data.foreground ?? ''),
          },
          typography: { fontFamily: String(data.fontFamily ?? '') },
        },
        name: String(data.name ?? ''),
        publish: true,
      })
      const result = await trpcClient.brandKit.list.query()
      setBrandKits(result.brandKits)
      form.reset()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <BrandVoiceSection canManage={canManage} />
      <Section title="Saved brand kits">
        <Group>
          {brandKits.length === 0 ? (
            <Row>
              <p className="text-sm text-neutral-500">No brand kits have been created.</p>
            </Row>
          ) : (
            brandKits.map((brandKit) => (
              <div className="flex items-center justify-between gap-4 px-5 py-4" key={brandKit.id}>
                <span className="min-w-0 truncate text-sm text-white">{brandKit.name}</span>
                <Pill tone={brandKit.status.toLowerCase() === 'active' ? 'green' : 'gray'}>
                  v{brandKit.version} · {brandKit.status.toLowerCase()}
                </Pill>
              </div>
            ))
          )}
        </Group>
      </Section>
      {canManage ? (
        <Section title="Create a new active version">
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <Group>
              <Row label={<label htmlFor="brand-name">Brand kit name</label>}>
                <Input className="h-10 rounded-lg md:w-72" id="brand-name" name="name" required />
              </Row>
              <Row description="Hex values, like #6d5dfc." label="Colors" layout="stacked">
                <div className="grid w-full gap-3 sm:grid-cols-3">
                  <ColorField
                    defaultValue="#111111"
                    id="brand-foreground"
                    label="Text"
                    name="foreground"
                  />
                  <ColorField
                    defaultValue="#ffffff"
                    id="brand-background"
                    label="Background"
                    name="background"
                  />
                  <ColorField
                    defaultValue="#6d5dfc"
                    id="brand-accent"
                    label="Accent"
                    name="accent"
                  />
                </div>
              </Row>
              <Row label={<label htmlFor="brand-font-family">Primary typeface</label>}>
                <Input
                  className="h-10 rounded-lg md:w-72"
                  id="brand-font-family"
                  name="fontFamily"
                  placeholder="Inter"
                  required
                />
              </Row>
            </Group>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex justify-end">
              <Button className="rounded-lg" disabled={isSaving} type="submit">
                {isSaving ? 'Publishing…' : 'Publish brand kit'}
              </Button>
            </div>
          </form>
        </Section>
      ) : null}
    </div>
  )
}

/** "x: @acme" lines to { x: '@acme' }; null when a line is not "network: handle". */
function parseHandles(value: string): Record<string, string> | null {
  const handles: Record<string, string> = {}
  for (const line of value.split(/\r?\n/)) {
    if (!line.trim()) continue
    const colon = line.indexOf(':')
    const network = line.slice(0, Math.max(colon, 0)).trim()
    const handle = line.slice(colon + 1).trim()
    if (!network || !handle) return null
    handles[network] = handle
  }
  return handles
}

function formatHandles(value: unknown): string {
  return value && typeof value === 'object'
    ? Object.entries(value as Record<string, string>)
        .map(([network, handle]) => `${network}: ${handle}`)
        .join('\n')
    : ''
}

function formatList(value: unknown): string {
  return Array.isArray(value) ? value.join(', ') : ''
}

function BrandVoiceSection({ canManage }: WorkspaceBrandSettingsProps) {
  const trpcClient = useTRPCClient()
  // undefined until loaded; null when the workspace has no brand voice yet.
  const [profile, setProfile] = useState<BrandProfile | null>()
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const inputClassName = 'h-10 rounded-lg md:w-72'
  const textareaClassName = 'min-h-24 rounded-lg'

  useEffect(() => {
    // Reading the brand voice takes the same permission as editing it.
    if (!canManage) return
    trpcClient.brandProfile.get
      .query()
      .then((result) => setProfile(result.brandProfile))
      .catch((requestError) => setError(getErrorMessage(requestError)))
  }, [canManage, trpcClient])

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    setMessage('')
    const data = new FormData(event.currentTarget)
    const text = (name: string) => String(data.get(name) ?? '').trim()
    const list = (name: string) =>
      text(name)
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    const socialHandles = parseHandles(text('socialHandles'))
    if (!socialHandles) {
      setError('Put one social handle per line, like x: @handle.')
      return
    }
    setIsSaving(true)
    try {
      await trpcClient.brandProfile.upsert.mutate({
        audience: text('audience'),
        ctaConventions: text('ctaConventions') || undefined,
        preferredStyles: list('preferredStyles'),
        productDescription: text('productDescription'),
        prohibitedTerms: list('prohibitedTerms'),
        socialHandles,
        tagline: text('tagline') || undefined,
        tone: text('tone'),
      })
      setMessage('Brand voice saved.')
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Section
      description="The AI writes launch copy in this voice and never uses the terms you prohibit."
      title="Brand voice"
    >
      {/* Remounts once loaded so the fields show the saved values. */}
      <form key={profile === undefined ? 'loading' : 'loaded'} onSubmit={handleSubmit}>
        {/* Locked until the saved voice loads, so a save never overwrites values it did not show. */}
        <fieldset
          className="flex min-w-0 flex-col gap-4"
          disabled={!canManage || profile === undefined}
        >
          <Group>
            <Row
              label={<label htmlFor="brand-voice-product">Product description</label>}
              layout="stacked"
            >
              <Textarea
                className={textareaClassName}
                defaultValue={profile?.productDescription}
                id="brand-voice-product"
                maxLength={2_000}
                name="productDescription"
                required
              />
            </Row>
            <Row label={<label htmlFor="brand-voice-audience">Audience</label>} layout="stacked">
              <Textarea
                className={textareaClassName}
                defaultValue={profile?.audience}
                id="brand-voice-audience"
                maxLength={1_000}
                name="audience"
                required
              />
            </Row>
            <Row label={<label htmlFor="brand-voice-tone">Tone</label>}>
              <Input
                className={inputClassName}
                defaultValue={profile?.tone}
                id="brand-voice-tone"
                maxLength={500}
                name="tone"
                placeholder="Plain, confident, specific; no hype"
                required
              />
            </Row>
            <Row label={<label htmlFor="brand-voice-tagline">Tagline</label>}>
              <Input
                className={inputClassName}
                defaultValue={profile?.tagline ?? ''}
                id="brand-voice-tagline"
                maxLength={200}
                name="tagline"
              />
            </Row>
            <Row label={<label htmlFor="brand-voice-cta">Call-to-action conventions</label>}>
              <Input
                className={inputClassName}
                defaultValue={profile?.ctaConventions ?? ''}
                id="brand-voice-cta"
                maxLength={1_000}
                name="ctaConventions"
              />
            </Row>
            <Row
              description={
                <span id="brand-voice-never-hint">Comma-separated words and phrases.</span>
              }
              label={<label htmlFor="brand-voice-never">Never use</label>}
            >
              <Input
                aria-describedby="brand-voice-never-hint"
                className={inputClassName}
                defaultValue={formatList(profile?.prohibitedTerms)}
                id="brand-voice-never"
                name="prohibitedTerms"
                placeholder="cheap, guaranteed"
              />
            </Row>
            <Row
              description={<span id="brand-voice-styles-hint">Comma-separated.</span>}
              label={<label htmlFor="brand-voice-styles">Preferred styles</label>}
            >
              <Input
                aria-describedby="brand-voice-styles-hint"
                className={inputClassName}
                defaultValue={formatList(profile?.preferredStyles)}
                id="brand-voice-styles"
                name="preferredStyles"
                placeholder="Short sentences, second person"
              />
            </Row>
            <Row
              description={
                <span id="brand-voice-handles-hint">One per line, like x: @handle.</span>
              }
              label={<label htmlFor="brand-voice-handles">Social handles</label>}
              layout="stacked"
            >
              <Textarea
                aria-describedby="brand-voice-handles-hint"
                className={textareaClassName}
                defaultValue={formatHandles(profile?.socialHandles)}
                id="brand-voice-handles"
                name="socialHandles"
                placeholder={'x: @acme\nlinkedin: acme'}
              />
            </Row>
          </Group>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {canManage ? (
            <div className="flex items-center justify-end gap-4">
              <p className="text-sm text-neutral-400" role="status">
                {message}
              </p>
              <Button className="rounded-lg" disabled={isSaving} type="submit">
                {isSaving ? 'Saving…' : 'Save brand voice'}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-neutral-500">
              Only workspace admins can view and change the brand voice.
            </p>
          )}
        </fieldset>
      </form>
    </Section>
  )
}

function ColorField({
  defaultValue,
  id,
  label,
  name,
}: {
  defaultValue: string
  id: string
  label: string
  name: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-neutral-400" htmlFor={id}>
        {label}
      </label>
      <Input
        className="h-10 rounded-lg font-mono"
        defaultValue={defaultValue}
        id={id}
        name={name}
        pattern="#[0-9A-Fa-f]{6}"
        required
        type="text"
      />
    </div>
  )
}
