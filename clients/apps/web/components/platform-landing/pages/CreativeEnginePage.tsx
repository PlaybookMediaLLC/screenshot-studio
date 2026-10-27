import Link from 'next/link'
import { BrowserIcon as BrowserIcon } from '@phosphor-icons/react/dist/ssr/Browser'
import { PencilSimpleIcon as Edit02Icon } from '@phosphor-icons/react/dist/ssr/PencilSimple'
import { ImageIcon as Image01Icon } from '@phosphor-icons/react/dist/ssr/Image'
import { PaintBrushIcon as PaintBrush01Icon } from '@phosphor-icons/react/dist/ssr/PaintBrush'
import { DeviceMobileIcon as SmartPhone01Icon } from '@phosphor-icons/react/dist/ssr/DeviceMobile'
import { VideoIcon as Video01Icon } from '@phosphor-icons/react/dist/ssr/Video'
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
import { CreativeEngineStrip } from '../diagrams/CreativeEngineStrip'

const CONTROLS = [
  ['Frame', 'Safari · dark'],
  ['Background', 'Brand gradient'],
  ['Headline', 'Invoices that send themselves'],
  ['Font', 'Nearest to brand'],
  ['Export', 'PNG · 2x'],
] as const

const TOOLS = [
  { href: '/features/screenshot-beautifier', label: 'Screenshot editor' },
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
    <Window className="w-full max-w-[900px]" meta="A1 · hero · 16:9" title="Visual">
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
        <p className="text-white/50">product page</p>
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
        <p className="text-white/50">visual</p>
        <p className="text-white/85">A1 hero · variant A</p>
        <p className="pt-2 text-white/50">page token</p>
        <p className="text-white/85">HMAC · one visual · 5 min</p>
        <p className="pt-2 text-white/50">result</p>
        <p className="text-emerald-300">PNG saved to workspace</p>
      </div>
    </Window>
  )
}

/** /product/creative-engine: the editor as the platform renderer. */
export function CreativeEnginePage() {
  return (
    <MarketingShell
      finale={{
        lead: 'Try the editor on your own screenshots,',
        trail: 'included in every plan.',
      }}
    >
      <PageHero
        body="The open-source screenshot editor makes every visual. The AI captures your live product, frames it, applies your brand, and saves the result as layers in the editor. Open any of it and change it by hand."
        eyebrow={{ href: '/product', label: 'Creative engine', parent: 'Product' }}
        lead="Every visual is built in the Shots editor,"
        location="creative_engine_hero"
        secondary={{ href: '/editor', label: 'Open the editor' }}
        trail="so you can open it and change anything."
      >
        <HeroStage variant={1}>
          <DesignWindow />
        </HeroStage>
      </PageHero>

      <section className="mx-auto w-full max-w-[1280px] px-6 py-24 sm:px-10 sm:py-32">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-24">
          <p className="text-balance text-[24px] leading-[1.3] tracking-[-0.015em] text-white sm:text-[30px]">
            The same editor founders use, included in every plan.{' '}
            <span className={MUTED}>
              Shots uses it to make launch visuals too, so you and the AI edit the same file.
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
          body="Capture, frame, brand, render, and edit. Each step has one narrow job and a check at the end."
          label="Pipeline"
          lead="Five steps from a live page"
          trail="to a visual you can edit."
        />
        <div className="mt-24 space-y-24">
          <CreativeEngineStrip />
          <SplitFeature
            body="Shots captures your product pages and the release's source links, and nothing else. Every address is checked, and near-blank captures are rejected."
            bullets={[
              'Product pages carry a name, a URL, and an environment',
              'Production, staging, demo, or development',
              'Captures are saved to your workspace',
              'Pages behind a login are not supported yet',
            ]}
            index={0}
            title="Capture the real product"
          >
            <CaptureWindow />
          </SplitFeature>
          <SplitFeature
            body="Shots places the capture in a device or browser frame with a headline. The AI can use every frame, background, and font in the editor."
            bullets={[FRAMES_SENTENCE]}
            index={1}
            title="Compose it in a frame"
          >
            <BrowserWidget />
          </SplitFeature>
          <SplitFeature
            body="Your brand kit is applied to every visual: a gradient from the brand background to the accent, the brand text color, and the nearest font in the catalog. Nobody picks a hex code twice."
            index={2}
            link={{ href: '/product/launch-intelligence', label: 'How visuals get checked' }}
            title="Apply the brand"
          >
            <BrandWidget />
          </SplitFeature>
          <SplitFeature
            body={`Visuals render in headless Chromium. The render browser holds no customer credentials. Each page carries a token for one visual that expires in five minutes. Rendering is limited to ${DESIGN_RENDER_RATE_LIMIT.maxRequests} a minute per workspace, and cached visuals do not count.`}
            index={3}
            title="Render without credentials"
          >
            <RenderWindow />
          </SplitFeature>
          <SplitFeature
            body="Every visual opens in the editor. Change anything, then save it back to the workspace or download it. Saved visuals can be reopened, edited, and saved again as PNG, JPEG, or WebP."
            index={4}
            title="Edit by hand, any time"
          >
            <TimelineWidget />
          </SplitFeature>
        </div>
      </Section>

      <Section>
        <SectionIntro
          body={`Everything the editor can do, Shots can render: ${EXPORT_FORMATS_SENTENCE} export, motion, and mockups.`}
          label="Editor"
          lead="The AI can use every editor feature,"
          trail="from device frames to motion."
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
            <p className="text-[26px] tracking-[-0.02em] text-white sm:text-[30px]">Image tools</p>
            <p className={cn('mt-4 max-w-[480px] text-lg leading-[1.55]', MUTED)}>
              The same engine powers focused tools that run in your browser, included in every
              plan.
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
            a: 'No. Each one is an editor file with its frame, background, headline, and capture as separate layers. Open it and move anything.',
          },
          {
            q: 'Which pages can it capture?',
            a: 'Public pages: your product pages and the source links on a release. Pages behind a login are not supported yet.',
          },
          {
            q: 'Can I use just the editor?',
            a: `Yes. The editor is ${PRODUCT_FACTS.license} licensed, included in every plan, and adds no watermark.`,
          },
          {
            q: 'Where are visuals rendered?',
            a: 'In headless Chromium on a remote browser service. That browser never receives your credentials, only a short-lived token for the one visual it renders.',
          },
        ]}
      />
    </MarketingShell>
  )
}
