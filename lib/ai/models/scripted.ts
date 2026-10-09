import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4GenerateResult,
} from '@ai-sdk/provider'
import { MockLanguageModelV4 } from 'ai/test'

/**
 * A deterministic stand-in model for end-to-end tests, so the launch pipeline
 * runs without a provider key or network.
 *
 * It reads the same prompts the real model gets and answers each stage's
 * submit tool with a valid, plain submission built from the brief, the
 * sources, the spec, and the plan in the prompt. It never cites flagged
 * sources and never follows text inside them. It is not a quality bar for the
 * real model; it exercises wiring, validation, persistence, and the UI.
 *
 * Enabled only with PLATFORM_AI_SCRIPTED=1 outside production builds.
 */

export function isScriptedModelEnabled(): boolean {
  return process.env.PLATFORM_AI_SCRIPTED === '1' && process.env.NODE_ENV !== 'production'
}

type ToolCall = { input: unknown; toolName: string }
type ToolResult = { output: unknown; toolName: string }

function readPrompt(options: LanguageModelV4CallOptions) {
  const texts: string[] = []
  const calls: ToolCall[] = []
  const results: ToolResult[] = []
  for (const message of options.prompt) {
    if (message.role === 'system') continue
    for (const part of message.content as unknown as Array<Record<string, unknown>>) {
      if (part.type === 'text' && typeof part.text === 'string') texts.push(part.text)
      if (part.type === 'tool-call') {
        let input: unknown = part.input
        if (typeof input === 'string') {
          try {
            input = JSON.parse(input)
          } catch {
            // keep the raw string
          }
        }
        calls.push({ input, toolName: String(part.toolName) })
      }
      if (part.type === 'tool-result') {
        const output = part.output as { type?: string; value?: unknown } | undefined
        let value: unknown = output?.value
        if (output?.type === 'content' && Array.isArray(value)) {
          const text = (value as Array<{ text?: string; type: string }>).find(
            (item) => item.type === 'text'
          )
          try {
            value = text?.text ? JSON.parse(text.text) : value
          } catch {
            value = text?.text
          }
        }
        results.push({ output: value, toolName: String(part.toolName) })
      }
    }
  }
  return { calls, results, text: texts.join('\n\n') }
}

function toolNames(options: LanguageModelV4CallOptions): string[] {
  return (options.tools ?? []).map((tool) => ('name' in tool ? tool.name : '')).filter(Boolean)
}

function toolProperties(options: LanguageModelV4CallOptions, name: string): string[] {
  const tool = (options.tools ?? []).find((entry) => 'name' in entry && entry.name === name)
  const schema =
    tool && 'inputSchema' in tool
      ? (tool.inputSchema as { properties?: Record<string, unknown> })
      : null
  return Object.keys(schema?.properties ?? {})
}

const clip = (value: string, max: number) =>
  value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`
const firstSentence = (value: string) => (value.match(/^[^.!?]+[.!?]?/)?.[0] ?? value).trim()

let callCounter = 0
const callId = () => `scripted-${Date.now().toString(36)}-${(callCounter += 1)}`

function toolCalls(calls: Array<{ input: unknown; toolName: string }>): LanguageModelV4Content[] {
  return calls.map((call) => ({
    input: JSON.stringify(call.input),
    toolCallId: callId(),
    toolName: call.toolName,
    type: 'tool-call' as const,
  }))
}

// ------------------------------------------------------------------ spec --

type ParsedSource = { flagged: boolean; id: string; text: string }

function parseSources(text: string): ParsedSource[] {
  const sources: ParsedSource[] = []
  const pattern = /<source id="(S\d+)"[^>]*?flagged="(true|false)"[^>]*>\n([\s\S]*?)\n<\/source>/g
  for (const match of text.matchAll(pattern)) {
    sources.push({ flagged: match[2] === 'true', id: match[1]!, text: match[3]! })
  }
  return sources
}

function field(text: string, label: string): string {
  return text.match(new RegExp(`^${label}: (.+)$`, 'm'))?.[1]?.trim() ?? ''
}

function facts(source: ParsedSource): string[] {
  return source.text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(- |#+ )/.test(line))
    .map((line) => line.replace(/^(- |#+ )/, '').trim())
    .filter((line) => line.length > 8 && line.length < 400)
    .slice(0, 8)
}

function scriptSpec(text: string) {
  const title = field(text, 'Release title') || 'This release'
  const why = field(text, 'Why it matters') || `${title} is now available.`
  const audience = field(text, 'Audience')
  const citable = (text.match(/You may cite: ([^\n]+?)\.\n/)?.[1] ?? 'brief')
    .split(',')
    .map((value) => value.trim())
  const clean = parseSources(text).filter(
    (source) => !source.flagged && citable.includes(source.id)
  )
  const evidence = clean.flatMap((source) => facts(source).map((fact) => ({ fact, id: source.id })))
  const capabilityFacts = evidence.filter((entry) => /[:—–]/.test(entry.fact)).slice(0, 3)
  const capabilities = (capabilityFacts.length ? capabilityFacts : evidence.slice(0, 2)).map(
    ({ fact, id }) => {
      const [name, ...rest] = fact.split(/\s*[:—–]\s*/)
      return {
        description: clip(rest.join(' ') || fact, 600),
        name: clip(name || fact, 120),
        sources: [id],
      }
    }
  )
  if (capabilities.length === 0)
    capabilities.push({ description: clip(why, 600), name: clip(title, 120), sources: ['brief'] })
  const firstSource = clean[0]?.id
  return {
    audience: audience
      ? [{ need: clip(why, 500), segment: clip(audience, 160), sources: ['brief'] }]
      : [],
    beforeAfter: [],
    capabilities,
    faqs: [
      {
        answer: clip(audience ? `${title} is for ${audience}.` : why, 800),
        question: clip(`Who is ${title} for?`, 300),
        sources: ['brief'],
      },
    ],
    limitations: [],
    messaging: {
      ctas: [clip(`Try ${title}`, 120)],
      pillars: [
        { message: clip(why, 500), sources: ['brief'], title: 'Why it matters' },
        {
          message: capabilities[0]!.description,
          sources: capabilities[0]!.sources,
          title: capabilities[0]!.name,
        },
      ],
      positioning: { alternatives: [], sources: [], statement: '' },
    },
    openQuestions: [
      {
        answer: '',
        question: 'What measurable result can we cite?',
        reason: 'No source gives a number for the outcome.',
        section: 'proofPoints',
      },
      ...(audience
        ? []
        : [
            {
              answer: '',
              question: 'Who is the primary audience?',
              reason: 'The brief does not say.',
              section: 'audience',
            },
          ]),
    ],
    problem: [{ sources: ['brief'], text: clip(why, 600) }],
    proofPoints: [],
    summary: {
      sources: firstSource ? ['brief', firstSource] : ['brief'],
      text: clip(`${title}: ${why}${evidence[0] ? ` ${evidence[0].fact}` : ''}`, 1_200),
    },
    whatChanged: (evidence.length ? evidence.slice(0, 3) : [{ fact: title, id: 'brief' }]).map(
      ({ fact, id }) => ({
        sources: [id],
        text: clip(fact, 600),
      })
    ),
  }
}

// ------------------------------------------------------------------ plan --

type Claim = { ref: string; text: string }

function parseClaims(text: string): Claim[] {
  const block =
    text.match(/Claims \(cite these refs\):\n([\s\S]*?)(\nUnknowns|\n<\/spec>)/)?.[1] ?? ''
  return block
    .split('\n')
    .map((line) => line.match(/^- ([A-Za-z.]+(?:\.\d+)?): (.+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({ ref: match[1]!, text: match[2]! }))
}

function captureUrls(text: string): string[] {
  const block = text.match(/<capture_urls>\n([\s\S]*?)\n<\/capture_urls>/)?.[1] ?? ''
  return block.split('\n').filter((line) => /^https?:\/\//.test(line))
}

function scriptPlan(text: string) {
  const claims = parseClaims(text)
  const pick = (prefix: string) => claims.find((claim) => claim.ref.startsWith(prefix))
  const pillar = pick('messaging.pillars') ?? claims[0]!
  const capability = pick('capabilities') ?? pillar
  const headline = clip(capability.text.split(':')[0] ?? capability.text, 60)
  return {
    angles: [
      {
        hook: clip(pillar.text, 400),
        key: 'G1',
        pillar: clip(pillar.text.split(':')[0]!, 160),
        specRefs: [pillar.ref],
        title: 'The outcome',
      },
      {
        hook: clip(capability.text, 400),
        key: 'G2',
        pillar: clip(capability.text.split(':')[0]!, 160),
        specRefs: [capability.ref],
        title: 'How it works',
      },
    ],
    assets: [
      {
        angleKey: 'G1',
        capability: clip(capability.text.split(':')[0]!, 160),
        captureHint: { device: 'desktop', focus: 'The main product screen', url: '' },
        format: '16:9',
        headline,
        key: 'A1',
        kind: 'hero',
        variants: 2,
      },
      {
        angleKey: 'G2',
        capability: clip(capability.text.split(':')[0]!, 160),
        captureHint: {
          device: 'desktop',
          focus: 'The feature in use',
          url: captureUrls(text)[0] ?? '',
        },
        format: '1:1',
        headline,
        key: 'A2',
        kind: 'social_card',
        variants: 1,
      },
    ],
    channels: [
      {
        cadence: 'A teaser, launch day, and one follow-up',
        channel: 'x',
        role: 'Reach practitioners where they talk shop',
      },
      {
        cadence: 'Launch day and one follow-up',
        channel: 'linkedin',
        role: 'Reach buyers and decision makers',
      },
      { cadence: 'Launch day', channel: 'product_hunt', role: 'Reach early adopters' },
      { cadence: 'Launch day', channel: 'changelog', role: 'Tell existing users what changed' },
      { cadence: 'Launch day', channel: 'email', role: 'Tell customers directly' },
    ],
    summary:
      'Lead with the outcome on launch day across every channel, then follow up with how it works.',
    timeline: [
      { angleKey: 'G1', assetKeys: ['A2'], channel: 'x', day: -2, note: 'Teaser', phase: 'teaser' },
      { angleKey: 'G1', assetKeys: ['A1'], channel: 'x', day: 0, note: '', phase: 'launch' },
      { angleKey: 'G1', assetKeys: ['A1'], channel: 'linkedin', day: 0, note: '', phase: 'launch' },
      {
        angleKey: 'G1',
        assetKeys: ['A1'],
        channel: 'product_hunt',
        day: 0,
        note: '',
        phase: 'launch',
      },
      { angleKey: 'G2', assetKeys: [], channel: 'changelog', day: 0, note: '', phase: 'launch' },
      { angleKey: 'G1', assetKeys: ['A1'], channel: 'email', day: 0, note: '', phase: 'launch' },
      {
        angleKey: 'G2',
        assetKeys: ['A2'],
        channel: 'linkedin',
        day: 3,
        note: 'How it works',
        phase: 'follow_up',
      },
    ],
  }
}

// ------------------------------------------------------------------ copy --

type PlanShape = ReturnType<typeof scriptPlan>

function parsePlan(text: string): PlanShape | null {
  const json = text.match(/<plan version="\d+">\n([\s\S]*?)\n<\/plan>/)?.[1]
  try {
    return json ? (JSON.parse(json) as PlanShape) : null
  } catch {
    return null
  }
}

function scriptCopy(text: string) {
  const claims = parseClaims(text)
  const plan = parsePlan(text)
  if (!plan) return { posts: [] }
  const claimFor = (ref: string) => claims.find((claim) => claim.ref === ref) ?? claims[0]!
  const requested = text.match(/Write the ([a-z_]+) posts:/)?.[1]
  const channels = plan.channels.filter(({ channel }) => !requested || channel === requested)
  const posts = channels.flatMap(({ channel }) =>
    plan.angles.slice(0, 2).map((angle) => {
      const claim = claimFor(angle.specRefs[0]!)
      const fact = claim.text.replace(/^[^:]{1,80}:\s*/, '')
      const base = {
        angleKey: angle.key,
        claims: [{ ref: claim.ref, text: clip(claim.text, 300) }],
        phase: 'launch',
      }
      switch (channel) {
        case 'x':
          return {
            ...base,
            callToAction: 'Try it today.',
            channel,
            copy: clip(`${angle.title}: ${fact}`, 240),
            title: '',
          }
        case 'linkedin':
          return {
            ...base,
            callToAction: 'Try it today.',
            channel,
            copy: `${angle.hook}\n\n${fact}\n\nIt is available now.`,
            title: '',
          }
        case 'product_hunt':
          return {
            ...base,
            callToAction: '',
            channel,
            copy: clip(fact, 250),
            title: clip(angle.title, 60),
          }
        case 'changelog':
          return {
            ...base,
            callToAction: '',
            channel,
            copy: `- ${fact}`,
            title: clip(angle.title, 100),
          }
        case 'email':
          return {
            ...base,
            callToAction: 'Try it today.',
            channel,
            copy: `Hi there,\n\n${angle.hook}\n\n${fact}`,
            title: clip(`New: ${angle.title}`, 90),
          }
        default:
          return { ...base, callToAction: '', channel, copy: clip(fact, 2_000), title: '' }
      }
    })
  )
  return { posts }
}

// ------------------------------------------------------------- revisions --

function block(text: string, tag: string): string | null {
  return text.match(new RegExp(`<${tag}[^>]*>\\n([\\s\\S]*?)\\n</${tag}>`))?.[1] ?? null
}

function revisionLead(comment: string): string {
  if (/time|hour|faster|quick/i.test(comment)) return 'Get hours back each month.'
  return clip(firstSentence(comment).replace(/^(please\s+)?(make it|make this|be)\s+/i, ''), 80)
}

function scriptRevision(text: string, properties: string[]) {
  const comment = block(text, 'reviewer_comment') ?? 'Revise it.'
  const lead = revisionLead(comment)
  if (properties.includes('changes')) {
    const design = JSON.parse(block(text, 'design') ?? '{}') as {
      texts?: Array<Record<string, unknown>>
    }
    const texts = (design.texts ?? []).map((entry, index) =>
      index === 0 ? { ...entry, text: clip(lead, 120) } : entry
    )
    return { changes: texts.length ? { texts } : {}, summary: `Headline now leads with: ${lead}` }
  }
  if (properties.includes('relatedPosts')) {
    const section = JSON.parse(block(text, 'section') ?? 'null') as unknown
    const revised = Array.isArray(section)
      ? section.map((item, index) =>
          index === 0 && item && typeof item === 'object' && 'text' in item
            ? { ...item, text: clip(`${lead} ${(item as { text: string }).text}`, 600) }
            : item
        )
      : section
    return { after: revised, relatedPosts: [], summary: `Section now leads with: ${lead}` }
  }
  const plan = parsePlan(text)
  if (plan && /<plan version/.test(text) && !block(text, 'post')) {
    return {
      after: { ...plan, summary: clip(`${lead} ${plan.summary}`, 800) },
      summary: `Plan now leads with: ${lead}`,
    }
  }
  const post = JSON.parse(block(text, 'post') ?? '{}') as {
    callToAction: string
    claims: unknown
    copy: string
    title: string
  }
  const channel = text.match(/<post channel="([a-z_]+)"/)?.[1] ?? 'linkedin'
  const limit =
    channel === 'x'
      ? 270 - (post.callToAction?.length ?? 0)
      : channel === 'product_hunt'
        ? 250
        : 2_800
  return {
    after: { ...post, copy: clip(`${lead} ${post.copy}`, limit) },
    summary: `Leads with: ${lead}`,
  }
}

// --------------------------------------------------------------- visuals --

function scriptVisuals(text: string, results: ToolResult[], calls: ToolCall[]): ToolCall[] | null {
  const capture = results.find((result) => result.toolName === 'captureProductPage')?.output as
    { assetId?: string; ok?: boolean } | undefined
  if (!calls.some((call) => call.toolName === 'captureProductPage')) {
    const url = captureUrls(text)[0]
    return url
      ? [
          {
            input: { colorScheme: 'light', device: 'desktop', url },
            toolName: 'captureProductPage',
          },
        ]
      : null
  }
  if (
    !capture?.ok ||
    !capture.assetId ||
    calls.some((call) => call.toolName === 'createProductShot')
  )
    return null
  const plan = parsePlan(text)
  const brand = text.match(
    /background gradient from (#[0-9a-f]{6}) to (#[0-9a-f]{6}).*?text (#[0-9a-f]{6})/i
  )
  const palettes = [
    { from: brand?.[1] ?? '#1e1b4b', text: brand?.[3] ?? '#ffffff', to: brand?.[2] ?? '#7c3aed' },
    { from: brand?.[2] ?? '#0f172a', text: brand?.[3] ?? '#ffffff', to: brand?.[1] ?? '#2563eb' },
  ]
  const format = (value: string) =>
    value === '16:9'
      ? 'landscape'
      : value === '9:16'
        ? 'story'
        : value === '4:5'
          ? 'portrait'
          : 'square'
  return (plan?.assets ?? []).flatMap((asset) =>
    Array.from({ length: asset.variants }, (_, index) => ({
      input: {
        background: { from: palettes[index]!.from, to: palettes[index]!.to },
        caption: `${asset.capability} (${asset.key}${asset.variants > 1 ? ` ${index === 0 ? 'A' : 'B'}` : ''})`,
        captureAssetId: capture.assetId,
        format: format(asset.format),
        headline: clip(asset.headline, 50),
        mockupId: 'macbook-pro-14-front',
        planAssetKey: asset.key,
        textColor: palettes[index]!.text,
        ...(asset.variants > 1 ? { variantLabel: index === 0 ? 'A' : 'B' } : {}),
      },
      toolName: 'createProductShot',
    }))
  )
}

// ---------------------------------------------------------------- model --

const usage = {
  inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 0, total: 0 },
  outputTokens: { reasoning: 0, text: 0, total: 0 },
}

function respond(content: LanguageModelV4Content[]): LanguageModelV4GenerateResult {
  const hasCalls = content.some((part) => part.type === 'tool-call')
  return {
    content,
    finishReason: { raw: undefined, unified: hasCalls ? 'tool-calls' : 'stop' },
    usage,
    warnings: [],
  }
}

const SUBMIT_TOOLS = [
  'submitSpec',
  'submitPlan',
  'saveLaunchCopy',
  'proposeRevision',
  'submitCritique',
] as const

export function createScriptedModel(modelId: string): LanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: async (options) => {
      const names = toolNames(options)
      const { calls, results, text } = readPrompt(options)
      const submit = SUBMIT_TOOLS.find((name) => names.includes(name))
      if (submit) {
        // One submission per run; after it, finish with a sentence.
        if (results.some((result) => result.toolName === submit)) {
          return respond([{ text: 'Submitted.', type: 'text' }])
        }
        const input =
          submit === 'submitSpec'
            ? scriptSpec(text)
            : submit === 'submitPlan'
              ? scriptPlan(text)
              : submit === 'saveLaunchCopy'
                ? scriptCopy(text)
                : submit === 'submitCritique'
                  ? { brand: 5, issues: [], legibility: 5, specFidelity: 5, verdict: 'pass' }
                  : scriptRevision(text, toolProperties(options, 'proposeRevision'))
        return respond(toolCalls([{ input, toolName: submit }]))
      }
      if (names.includes('captureProductPage')) {
        const next = scriptVisuals(text, results, calls)
        if (next && next.length > 0) return respond(toolCalls(next))
        return respond([
          { text: 'Captured the product and made the planned product shots.', type: 'text' },
        ])
      }
      return respond([{ text: 'Done.', type: 'text' }])
    },
    modelId: `scripted/${modelId}`,
    provider: 'scripted',
  })
}
