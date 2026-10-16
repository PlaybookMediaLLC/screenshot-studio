'use client'

import { type ChangeEvent, type FormEvent, useEffect, useState } from 'react'
import { Group, Pill, Row, Section } from '@/components/platform-ui'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { fontFamilies } from '@/lib/constants/fonts'
import {
  contrastRatio,
  type ProhibitedTermEntry,
  prohibitedTermEntries,
  prohibitedTermsForSave,
} from '@/lib/launch/brand'
import {
  BRAND_LOGO_MAX_BYTES,
  brandLogoContentTypeSchema,
  prohibitedTermMatchModeSchema,
  type ProhibitedTermMatchMode,
} from '@/lib/tenant/schemas'
import { useTRPCClient } from '@/lib/trpc/react'
import { saveExportToWorkspace } from '@/lib/workspace/save-export'
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

type BrandColors = { accent: string; background: string; text: string }

const DEFAULT_COLORS: BrandColors = { accent: '#6d5dfc', background: '#ffffff', text: '#111111' }
const HEX_COLOR = /^#[0-9a-f]{6}$/i
/** WCAG AA contrast for body text. */
const MIN_TEXT_CONTRAST = 4.5

export function WorkspaceBrandSettings({ canManage }: WorkspaceBrandSettingsProps) {
  const trpcClient = useTRPCClient()
  const [brandKits, setBrandKits] = useState<BrandKitSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [colors, setColors] = useState(DEFAULT_COLORS)
  const [logo, setLogo] = useState<{ assetId: string; previewUrl: string } | null>(null)
  const [isUploadingLogo, setIsUploadingLogo] = useState(false)
  const contrast =
    HEX_COLOR.test(colors.text) && HEX_COLOR.test(colors.background)
      ? contrastRatio(colors.text, colors.background)
      : null

  useEffect(() => () => (logo ? URL.revokeObjectURL(logo.previewUrl) : undefined), [logo])

  useEffect(() => {
    trpcClient.brandKit.list
      .query()
      .then((result) => setBrandKits(result.brandKits))
      .catch((requestError) => setError(getErrorMessage(requestError)))
  }, [trpcClient])

  async function handleLogoChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    setError(null)
    if (!brandLogoContentTypeSchema.safeParse(file.type).success) {
      setError('Upload the logo as a PNG, WebP, or JPEG.')
      input.value = ''
      return
    }
    if (file.size > BRAND_LOGO_MAX_BYTES) {
      setError('The logo must be 5 MB or smaller.')
      input.value = ''
      return
    }
    setIsUploadingLogo(true)
    try {
      const { assetId } = await saveExportToWorkspace({
        blob: file,
        fileName: file.name.slice(-128),
        trpcClient,
      })
      setLogo({ assetId, previewUrl: URL.createObjectURL(file) })
    } catch (uploadError) {
      setError(getErrorMessage(uploadError))
      input.value = ''
    } finally {
      setIsUploadingLogo(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    const form = event.currentTarget
    const data = Object.fromEntries(new FormData(form))
    setIsSaving(true)
    try {
      await trpcClient.brandKit.create.mutate({
        definition: {
          colors,
          ...(logo ? { logo: { primaryAssetId: logo.assetId } } : {}),
          schemaVersion: 1,
          typography: { headingFamily: String(data.headingFamily ?? '') },
        },
        name: String(data.name ?? ''),
        publish: true,
      })
      const result = await trpcClient.brandKit.list.query()
      setBrandKits(result.brandKits)
      form.reset()
      setColors(DEFAULT_COLORS)
      setLogo(null)
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
                  {(['text', 'background', 'accent'] as const).map((key) => (
                    <ColorField
                      id={`brand-${key}`}
                      key={key}
                      label={key[0]!.toUpperCase() + key.slice(1)}
                      onChange={(value) => setColors((current) => ({ ...current, [key]: value }))}
                      value={colors[key]}
                    />
                  ))}
                </div>
                {contrast !== null && contrast < MIN_TEXT_CONTRAST ? (
                  <p className="text-sm text-amber-400" role="status">
                    Text on background contrast is {contrast.toFixed(1)}:1. Body text needs at least{' '}
                    {MIN_TEXT_CONTRAST}:1 to stay readable.
                  </p>
                ) : null}
              </Row>
              <Row label={<label htmlFor="brand-font-family">Primary typeface</label>}>
                <select
                  className="h-10 rounded-lg bg-white/[0.03] px-3 text-sm text-neutral-200 ring-1 ring-white/[0.08] outline-none md:w-72"
                  defaultValue="inter"
                  id="brand-font-family"
                  name="headingFamily"
                  required
                >
                  {fontFamilies.map((font) => (
                    <option key={font.id} value={font.id}>
                      {font.name}
                    </option>
                  ))}
                </select>
              </Row>
              <Row
                description="PNG, WebP, or JPEG, up to 5 MB."
                label={<label htmlFor="brand-logo">Logo</label>}
              >
                <div className="flex items-center gap-3">
                  {logo ? (
                    // A local object URL; next/image cannot optimize it.
                    <img
                      alt="Uploaded logo preview"
                      className="h-10 w-10 rounded-lg bg-white/[0.03] object-contain ring-1 ring-white/[0.08]"
                      src={logo.previewUrl}
                    />
                  ) : null}
                  <Input
                    accept={brandLogoContentTypeSchema.options.join(',')}
                    className="h-10 rounded-lg md:w-60"
                    disabled={isUploadingLogo}
                    id="brand-logo"
                    onChange={handleLogoChange}
                    type="file"
                  />
                </div>
              </Row>
            </Group>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex justify-end">
              <Button className="rounded-lg" disabled={isSaving || isUploadingLogo} type="submit">
                {isUploadingLogo
                  ? 'Uploading logo…'
                  : isSaving
                    ? 'Publishing…'
                    : 'Publish brand kit'}
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
  const [terms, setTerms] = useState<ProhibitedTermEntry[]>([])
  const inputClassName = 'h-10 rounded-lg md:w-72'
  const textareaClassName = 'min-h-24 rounded-lg'

  useEffect(() => {
    // Reading the brand voice takes the same permission as editing it.
    if (!canManage) return
    trpcClient.brandProfile.get
      .query()
      .then((result) => {
        setProfile(result.brandProfile)
        setTerms(prohibitedTermEntries(result.brandProfile?.prohibitedTerms))
      })
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
        prohibitedTerms: prohibitedTermsForSave(terms),
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
              description="Copy that uses one of these is refused, and the author sees your reason."
              label="Never use"
              layout="stacked"
            >
              <ProhibitedTermsEditor onChange={setTerms} value={terms} />
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

const MATCH_MODES: Record<ProhibitedTermMatchMode, string> = {
  phrase: 'Anywhere, even inside a word',
  word: 'As a whole word',
}

/** One row per prohibited term: the term, why it is off brand, and how it matches. */
function ProhibitedTermsEditor({
  onChange,
  value,
}: {
  onChange: (terms: ProhibitedTermEntry[]) => void
  value: ProhibitedTermEntry[]
}) {
  const update = (index: number, change: Partial<ProhibitedTermEntry>) =>
    onChange(value.map((entry, at) => (at === index ? { ...entry, ...change } : entry)))
  return (
    <div className="flex w-full flex-col gap-3">
      {value.length === 0 ? (
        <p className="text-sm text-neutral-500">No prohibited terms.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {value.map((entry, index) => (
            // Rows have no identity of their own; editing never reorders them.
            <li className="grid gap-2 md:grid-cols-[1fr_1.5fr_auto_auto]" key={index}>
              <Input
                aria-label={`Term ${index + 1}`}
                className="h-10 rounded-lg"
                maxLength={100}
                onChange={(event) => update(index, { term: event.target.value })}
                placeholder="guaranteed"
                value={entry.term}
              />
              <Input
                aria-label={`Reason for term ${index + 1}`}
                className="h-10 rounded-lg"
                maxLength={300}
                onChange={(event) => update(index, { reason: event.target.value })}
                placeholder="Why it is off brand (optional)"
                value={entry.reason}
              />
              <select
                aria-label={`How term ${index + 1} matches`}
                className="h-10 rounded-lg bg-white/[0.03] px-3 text-sm text-neutral-200 ring-1 ring-white/[0.08] outline-none"
                onChange={(event) =>
                  update(index, {
                    matchMode: prohibitedTermMatchModeSchema.parse(event.target.value),
                  })
                }
                value={entry.matchMode}
              >
                {prohibitedTermMatchModeSchema.options.map((mode) => (
                  <option key={mode} value={mode}>
                    {MATCH_MODES[mode]}
                  </option>
                ))}
              </select>
              <Button
                aria-label={`Remove term ${index + 1}`}
                className="h-10 rounded-lg"
                onClick={() => onChange(value.filter((_, at) => at !== index))}
                type="button"
                variant="ghost"
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button
        className="self-start rounded-lg"
        onClick={() => onChange([...value, { matchMode: 'word', reason: '', term: '' }])}
        size="sm"
        type="button"
        variant="outline"
      >
        Add term
      </Button>
    </div>
  )
}

function ColorField({
  id,
  label,
  onChange,
  value,
}: {
  id: string
  label: string
  onChange: (value: string) => void
  value: string
}) {
  const isValid = HEX_COLOR.test(value)
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-neutral-400" htmlFor={id}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          aria-label={`${label} color picker`}
          className="h-10 w-10 shrink-0 cursor-pointer rounded-lg bg-transparent"
          onChange={(event) => onChange(event.target.value)}
          type="color"
          value={isValid ? value.toLowerCase() : '#000000'}
        />
        <Input
          aria-invalid={!isValid}
          className="h-10 rounded-lg font-mono"
          id={id}
          onChange={(event) => onChange(event.target.value.trim())}
          pattern="#[0-9A-Fa-f]{6}"
          required
          title="A hex color, like #6d5dfc."
          type="text"
          value={value}
        />
      </div>
    </div>
  )
}
