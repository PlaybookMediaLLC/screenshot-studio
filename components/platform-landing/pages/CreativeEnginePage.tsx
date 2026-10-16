import Link from 'next/link'
import {
  BrowserIcon,
  Edit02Icon,
  Image01Icon,
  PaintBrush01Icon,
  SmartPhone01Icon,
  Video01Icon,
} from 'hugeicons-react'
import { DESIGN_RENDER_RATE_LIMIT } from '@/lib/api/rate-limit-policy'
import {
  atLeast,
  EXPORT_FORMATS_SENTENCE,
  FRAMES_SENTENCE,
  PRODUCT_FACTS,
} from '@/lib/seo/product-facts'
import { cn } from '@/lib/utils'
import {
  FaqBlock,
  HeroStage,
  MarketingShell,
  PageHero,
  SplitFeature,
  StatRows,
  TileGrid,
} from '../blocks'
import { MONO, MUTED, Section, SectionIntro, Window } from '../primitives'
import { BrandWidget, BrowserWidget, TimelineWidget } from '../sections'
import { CreativeMock } from '../WorkflowSection'

const CONTROLS = [
  ['Frame', 'Safari · dark'],
  ['Background', 'Brand gradient'],
  ['Headline', 'Invoices that send themselves'],
  ['Font', 'Nearest to brand'],
  ['Export', 'PNG · 2x'],
] as const

const TOOLS = [
  { href: '/free-screenshot-editor', label: 'Screenshot editor' },
  { href: '/mockup-generator', label: 'Mockup generator' },
  { href: '/store-screenshots', label: 'App Store screenshots' },
  { href: '/code', label: 'Code to image' },
  { href: '/tweet', label: 'Tweet to image' },
  { href: '/remove-background', label: 'Background remover' },
  { href: '/compress-video', label: 'Video compressor' },
  { href: '/tools', label: 'Image tools' },
]

function DesignWindow() {
  return (
    <Window className="w-full max-w-[900px]" meta="A1 · hero · 16:9" title="Design">
      <div className="grid gap-3 p-3 md:grid-cols-[1.6fr_1fr]">
        <CreativeMock className="aspect-[16/10]" />
        <dl className="divide-y divide-white/[0.06] rounded-lg bg-black/30 text-[13px]">
          {CONTROLS.map(([label, value]) => (
            <div className="flex items-center justify-between gap-4 px-4 py-3" key={label}>
              <dt className="text-[#858585]">{label}</dt>
              <dd className="truncate text-white/85">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Window>
  )
}

function CaptureWindow() {
  return (
    <Window meta="capture" title="captureProductPage">
      <div className={cn(MONO, 'space-y-2 p-4 text-[12px] leading-[1.6]')}>
        <p className="text-white/50">surface</p>
        <p className="text-white/85">Invoices · production · app.acme.com/invoices</p>
        <p className="pt-2 text-white/50">checks</p>
        <p className="text-emerald-300">public address · ssrf ok</p>
        <p className="text-emerald-300">not blank · 1440 × 900</p>
        <p className="pt-2 text-white/50">stored as</p>
        <p className="text-white/85">asset · kind: capture</p>
      </div>
    </Window>
  )
}

function RenderWindow() {
  return (
    <Window meta="headless Chromium" title="Render">
      <div className={cn(MONO, 'space-y-2 p-4 text-[12px] leading-[1.6]')}>
        <p className="text-white/50">design</p>
        <p className="text-white/85">A1 hero · variant A</p>
        <p className="pt-2 text-white/50">page token</p>
        <p className="text-white/85">HMAC · one design · 5 min</p>
        <p className="pt-2 text-white/50">result</p>
        <p className="text-emerald-300">PNG saved to workspace</p>
      </div>
    </Window>
  )
}

/** /product/creative-engine: the editor as the platform renderer. */
export function CreativeEnginePage() {
  return (
    <MarketingShell finale={{ lead: 'Real screenshots.', trail: 'On brand, every time.' }}>
      <PageHero
        body="The open-source screenshot editor does the rendering. Agents capture your live product, frame it, apply your brand, and save an editor design rather than a flat image. Open any of it and change it by hand."
        eyebrow={{ href: '/product', label: 'Creative engine', parent: 'Product' }}
        lead="The editor is the renderer."
        location="creative_engine_hero"
        secondary={{ href: '/free-screenshot-editor', label: 'Open the editor' }}
        trail="Every asset stays editable."
      >
        <HeroStage variant={1}>
          <DesignWindow />
        </HeroStage>
      </PageHero>

      <section className="mx-auto w-full max-w-[1280px] px-6 py-24 sm:px-10 sm:py-32">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-24">
          <p className="text-balance text-[24px] leading-[1.3] tracking-[-0.015em] text-white sm:text-[30px]">
            The same editor founders use for free.{' '}
            <span className={MUTED}>
              Now it renders for the platform too, so the agent and the person share one canvas.
            </span>
          </p>
          <StatRows
            stats={[
              {
                value: atLeast(PRODUCT_FACTS.backgrounds),
                label: 'backgrounds, gradients, and meshes',
              },
              { value: String(PRODUCT_FACTS.animationPresets), label: 'animation presets' },
              { value: `${PRODUCT_FACTS.maxExportScale}x`, label: 'maximum export scale' },
            ]}
          />
        </div>
      </section>

      <Section>
        <SectionIntro
          body="From a live page to an approved asset in four steps, each one a tool with a narrow job and a check at the end."
          label="Pipeline"
          lead="Capture, compose,"
          trail="render, edit."
        />
        <div className="mt-24 space-y-24">
          <SplitFeature
            body="The capture tool photographs the product surface and the release source links, nothing else. Every address is checked, and near-blank captures are rejected."
            bullets={[
              'Product surfaces carry a name, a URL, and an environment',
              'Production, staging, demo, or development',
              'Captures are stored as workspace assets',
              'Pages behind a login are not supported yet',
            ]}
            index={0}
            title="Capture the real product"
          >
            <CaptureWindow />
          </SplitFeature>
          <SplitFeature
            body="A product shot places the capture in a device or browser frame with a headline. Every frame, background, and font from the editor is available to the agent."
            bullets={[FRAMES_SENTENCE]}
            index={1}
            title="Compose it in a frame"
          >
            <BrowserWidget />
          </SplitFeature>
          <SplitFeature
            body="The brand kit is applied to every design: a gradient from the brand background to the accent, the brand text color, and the nearest font in the catalog. Nobody picks a hex code twice."
            index={2}
            link={{ href: '/product/launch-intelligence', label: 'How designs get critiqued' }}
            title="Apply the brand"
          >
            <BrandWidget />
          </SplitFeature>
          <SplitFeature
            body={`Designs render in headless Chromium. The render browser holds no customer credentials, and each page carries a token for one design that expires in five minutes. Renders are limited to ${DESIGN_RENDER_RATE_LIMIT.maxRequests} a minute per workspace, and cache hits do not count.`}
            index={3}
            title="Render without credentials"
          >
            <RenderWindow />
          </SplitFeature>
          <SplitFeature
            body="Every design opens in the editor. Change anything, save it back to the workspace, or download it. Saved assets can be reopened, edited, and saved again as PNG, JPEG, or WebP."
            index={4}
            title="Edit by hand, any time"
          >
            <TimelineWidget />
          </SplitFeature>
        </div>
      </Section>

      <Section>
        <SectionIntro
          body={`Everything the editor can do, the platform can render: ${EXPORT_FORMATS_SENTENCE} export, motion, and mockups.`}
          label="Editor"
          lead="Everything in the editor."
          trail="Available to every design."
        />
        <div className="mt-24">
          <TileGrid
            items={[
              {
                icon: BrowserIcon,
                title: 'Browser mockups',
                body: 'Safari and Chrome in light and dark, with realistic toolbars and a custom URL.',
              },
              {
                icon: SmartPhone01Icon,
                title: 'Device shells',
                body: `${PRODUCT_FACTS.deviceMockups} device mockups, including iPhone, MacBook, and Apple Watch, with drag, rotate, and screen crop.`,
              },
              {
                icon: Image01Icon,
                title: '3D and depth',
                body: 'Perspective presets, shadows, borders, and corner radius for a screenshot that sits in space.',
              },
              {
                icon: Edit02Icon,
                title: 'Markup',
                body: 'Arrows, shapes, text overlays, and blur regions to point at what changed and hide what should not show.',
              },
              {
                icon: Video01Icon,
                title: 'Motion',
                body: `${PRODUCT_FACTS.animationPresets} presets on a keyframe timeline, exported as MP4, WebM, or GIF in the browser.`,
              },
              {
                icon: PaintBrush01Icon,
                title: 'Type and backgrounds',
                body: `${PRODUCT_FACTS.fonts} fonts and ${atLeast(PRODUCT_FACTS.backgrounds)} gradients, meshes, solids, and images.`,
              },
            ]}
          />
        </div>
      </Section>

      <Section>
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-8">
          <div>
            <p className="text-[26px] tracking-[-0.02em] text-white sm:text-[30px]">Free tools</p>
            <p className={cn('mt-4 max-w-[480px] text-lg leading-[1.55]', MUTED)}>
              The creative engine also powers focused tools that run in your browser on a free
              workspace.
            </p>
          </div>
          <ul className="grid grid-cols-2 gap-px overflow-hidden border border-[#212121] bg-[#212121]">
            {TOOLS.map((tool) => (
              <li key={tool.href}>
                <Link
                  className="block bg-[#090909] px-5 py-5 text-[15px] text-white/85 transition-colors hover:bg-[#111] hover:text-white"
                  href={tool.href}
                >
                  {tool.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <FaqBlock
        items={[
          {
            q: 'Are generated visuals flat images?',
            a: 'No. Each one is an editor design with its frame, background, headline, and capture as separate layers. Open it and move anything.',
          },
          {
            q: 'Which pages can it capture?',
            a: 'Public pages: your product surfaces and the source links on a release. Pages behind a login are not supported yet.',
          },
          {
            q: 'Can I use the editor without the platform?',
            a: `Yes. The editor is ${PRODUCT_FACTS.license} licensed and available on a free workspace with no watermark.`,
          },
          {
            q: 'Where do renders run?',
            a: 'In headless Chromium on a remote browser service. The browser never receives your credentials, only a short-lived token for the one design it renders.',
          },
        ]}
      />
    </MarketingShell>
  )
}
