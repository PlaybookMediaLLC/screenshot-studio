import { z } from 'zod'
import { getDeviceModel } from './devices'
import { CLAIM_KINDS } from './document/elements'
import { hashRichText } from './document/factory'
import type { StoreDocument } from './document/schema'
import { intersectionArea, rotatedBounds } from './engine/geometry'
import { STORE_PREVIEW_SCALE, type Scene, type SceneText } from './engine/scene'
import { localeName } from './locales'
import { getStoreTarget, sizeAccepted, targetPixelSize, type ExportOrientation, type ImageFormat, type StoreTarget } from './targets'

/**
 * Pre-export checks.
 *
 * Two kinds of findings are kept apart: `requirement` findings come from the
 * stores' published rules in the target catalog (sizes, counts, formats);
 * `recommendation` findings are design advice computed from the rendered
 * scenes (contrast, legibility, overlap, clipping, translation overflow).
 * Passing every check does not guarantee approval by App Review or Google
 * Play review, and the UI says so.
 */

/** Finding severity. */
export const issueSeveritySchema = z.enum(['requirement', 'recommendation'])

/** Finding codes. */
export const issueCodeSchema = z.enum([
  'too-few',
  'too-many',
  'size',
  'format',
  'required-target',
  'empty-device',
  'contrast',
  'small-text',
  'edge',
  'clipped',
  'overlap',
  'overflow',
  'cropped-screenshot',
  'status-bar',
  'claim',
  'translation-missing',
  'translation-outdated',
])

/** Severity. */
export type IssueSeverity = z.infer<typeof issueSeveritySchema>
/** Code. */
export type IssueCode = z.infer<typeof issueCodeSchema>

/** One finding, linked to where it applies. */
export type ComplianceIssue = {
  id: string
  code: IssueCode
  severity: IssueSeverity
  message: string
  targetId?: string
  slideId?: string
  layerId?: string
  locale?: string
  /** Store documentation the requirement comes from. */
  source?: string
}

/** What will be exported. */
export type ExportSelection = {
  targets: Array<{ targetId: string; sizeIndex: number; orientation: ExportOrientation }>
  format: ImageFormat
  locales: string[]
  slideIds: string[]
}

/** Evaluates a slide for the checks (the editor passes its DOM measurer). */
export type SceneEvaluator = (slideIndex: number, target: StoreTarget, sizeIndex: number, orientation: ExportOrientation, locale: string) => Scene

/** Margin text should keep from the edges, as a share of the slide width. */
const EDGE_MARGIN = 0.03
/** Smallest legible size, in CSS pixels, when the store shows the screenshot small. */
const MIN_PREVIEW_TEXT_PX = 8
/** Overlap (share of the text's area) that counts as text covering a device. */
const OVERLAP_SHARE = 0.08

function textIssues(scene: Scene, base: Omit<ComplianceIssue, 'id' | 'code' | 'severity' | 'message'>, unit: number): ComplianceIssue[] {
  const issues: ComplianceIssue[] = []
  const texts = scene.nodes.filter((node): node is SceneText => node.type === 'text')
  const devices = scene.nodes.filter((node) => node.type === 'device')
  const add = (code: IssueCode, node: SceneText, message: string) =>
    issues.push({ ...base, id: `${code}:${base.targetId}:${base.locale}:${node.layerId}`, code, severity: 'recommendation', layerId: node.layerId, message })
  for (const node of texts) {
    const ink = rotatedBounds(node.ink, node.rotation)
    const label = node.content.map((span) => span.text).join('').trim().slice(0, 40)
    if (node.contrast < node.requiredContrast) {
      add('contrast', node, `“${label}” has ${node.contrast.toFixed(1)}:1 contrast; ${node.requiredContrast}:1 keeps it readable at store size.`)
    }
    if ((node.fontSizePx / unit) * STORE_PREVIEW_SCALE < MIN_PREVIEW_TEXT_PX) {
      add('small-text', node, `“${label}” will be about ${Math.round((node.fontSizePx / unit) * STORE_PREVIEW_SCALE)} px tall in store listings, which is hard to read.`)
    }
    if (ink.x < 0 || ink.y < 0 || ink.x + ink.width > scene.width || ink.y + ink.height > scene.height) {
      add('clipped', node, `“${label}” is cut off by the slide edge.`)
    } else if (
      ink.x < scene.width * EDGE_MARGIN ||
      ink.x + ink.width > scene.width * (1 - EDGE_MARGIN) ||
      ink.y < scene.width * EDGE_MARGIN ||
      ink.y + ink.height > scene.height - scene.width * EDGE_MARGIN
    ) {
      add('edge', node, `“${label}” is very close to the edge and may look cramped or be trimmed in previews.`)
    }
    if (node.overflow) {
      add('overflow', node, node.translation === 'source' ? `“${label}” does not fit its space even at its smallest size.` : `The ${localeName(scene.locale)} text “${label}” does not fit. Shorten it or adjust it for this language.`)
    }
    const area = ink.width * ink.height
    for (const device of devices) {
      const overlap = intersectionArea(ink, rotatedBounds(device.box, device.rotation))
      if (area > 0 && overlap / area > OVERLAP_SHARE) {
        add('overlap', node, `“${label}” overlaps ${device.name}.`)
        break
      }
    }
    for (const other of texts) {
      if (other === node || other.layerId < node.layerId) continue
      if (intersectionArea(ink, rotatedBounds(other.ink, other.rotation)) > 4) add('overlap', node, `“${label}” overlaps other text.`)
    }
  }
  return issues
}

function deviceIssues(document: StoreDocument, scene: Scene, base: Omit<ComplianceIssue, 'id' | 'code' | 'severity' | 'message'>): ComplianceIssue[] {
  const issues: ComplianceIssue[] = []
  for (const node of scene.nodes) {
    if (node.type === 'device') {
      if (!node.assetId) {
        issues.push({ ...base, id: `empty:${base.targetId}:${node.layerId}`, code: 'empty-device', severity: 'recommendation', layerId: node.layerId, message: `${node.name} has no screenshot.` })
        continue
      }
      const visible = intersectionArea({ x: 0, y: 0, width: node.screen.width, height: node.screen.height }, node.image) / (node.image.width * node.image.height)
      if (visible < 0.7) {
        issues.push({ ...base, id: `crop:${base.targetId}:${node.layerId}`, code: 'cropped-screenshot', severity: 'recommendation', layerId: node.layerId, message: `Only ${Math.round(visible * 100)}% of the screenshot in ${node.name} is visible; important UI may be hidden.` })
      }
      const asset = document.assets[node.assetId]
      const fullScreen = asset ? Math.abs(asset.width / asset.height - getDeviceModel(node.frame.modelId).screenAspect) < 0.02 : false
      if (node.statusBar.visible && !node.statusBar.cover && fullScreen) {
        issues.push({ ...base, id: `bar:${base.targetId}:${node.layerId}`, code: 'status-bar', severity: 'recommendation', layerId: node.layerId, message: `${node.name} may show two status bars. Turn on “Cover the original”.` })
      }
    }
    if (node.type === 'annotation' && CLAIM_KINDS.has(node.annotation.kind)) {
      issues.push({ ...base, id: `claim:${node.layerId}`, code: 'claim', severity: 'recommendation', layerId: node.layerId, message: `Check that the ${node.annotation.kind} “${node.annotation.text || '(empty)'}” is accurate and sourced; stores reject unverifiable claims.` })
    }
  }
  return issues
}

/** Store rules for a target that do not depend on rendering. */
export function targetRequirementIssues(selection: ExportSelection): ComplianceIssue[] {
  const issues: ComplianceIssue[] = []
  const count = selection.slideIds.length
  for (const choice of selection.targets) {
    const target = getStoreTarget(choice.targetId)
    if (!target) continue
    const base = { targetId: target.id, source: target.source }
    if (count < target.minCount) {
      issues.push({ ...base, id: `few:${target.id}`, code: 'too-few', severity: 'requirement', message: `${target.shortName} needs at least ${target.minCount} screenshots; ${count} selected.` })
    }
    if (count > target.maxCount) {
      issues.push({ ...base, id: `many:${target.id}`, code: 'too-many', severity: 'requirement', message: `${target.shortName} accepts at most ${target.maxCount} screenshots; ${count} selected. Choose which slides to export.` })
    }
    if (!target.formats.includes(selection.format)) {
      issues.push({ ...base, id: `format:${target.id}`, code: 'format', severity: 'requirement', message: `${target.shortName} does not accept ${selection.format.toUpperCase()}.` })
    }
    const size = targetPixelSize(target, choice.sizeIndex, choice.orientation)
    if (!sizeAccepted(target, size)) {
      issues.push({ ...base, id: `size:${target.id}`, code: 'size', severity: 'requirement', message: `${size.width} × ${size.height} is not an accepted ${target.shortName} size.` })
    }
  }
  const ids = new Set(selection.targets.map((item) => item.targetId))
  const iphone = selection.targets.some((item) => getStoreTarget(item.targetId)?.store === 'app-store' && getStoreTarget(item.targetId)?.family === 'phone')
  if (iphone && !ids.has('ios-iphone-6.3')) {
    const target = getStoreTarget('ios-iphone-6.3')!
    issues.push({ id: 'required:ios-iphone-6.3', code: 'required-target', severity: 'requirement', targetId: target.id, source: target.source, message: `Apple requires ${target.name} (${target.shortName}) screenshots for apps that run on iPhone. Add it to this export unless you upload that set separately.` })
  }
  const play = selection.targets.some((item) => getStoreTarget(item.targetId)?.store === 'google-play')
  if (play && !ids.has('play-phone')) {
    const target = getStoreTarget('play-phone')!
    issues.push({ id: 'required:play-phone', code: 'required-target', severity: 'requirement', targetId: target.id, source: target.source, message: 'Google Play needs at least 2 phone screenshots to publish.' })
  }
  return issues
}

/** Translation completeness for exported locales. */
export function localeIssues(document: StoreDocument, selection: ExportSelection): ComplianceIssue[] {
  const issues: ComplianceIssue[] = []
  const wanted = new Set(selection.slideIds)
  for (const locale of selection.locales) {
    if (locale === document.localization.sourceLocale) continue
    for (const slide of document.slides) {
      if (!wanted.has(slide.id)) continue
      for (const layer of slide.layers) {
        if (layer.type !== 'text' || !layer.content.some((span) => span.text.trim())) continue
        const translation = layer.translations[locale]
        const quote = layer.content.map((span) => span.text).join('').slice(0, 40)
        if (!translation) {
          issues.push({ id: `missing:${locale}:${layer.id}`, code: 'translation-missing', severity: 'recommendation', slideId: slide.id, layerId: layer.id, locale, message: `${localeName(locale)} has no translation for “${quote}”; the source text will be exported.` })
        } else if (translation.sourceHash !== hashRichText(layer.content)) {
          issues.push({ id: `outdated:${locale}:${layer.id}`, code: 'translation-outdated', severity: 'recommendation', slideId: slide.id, layerId: layer.id, locale, message: `The ${localeName(locale)} text for “${quote}” was translated before the source changed.` })
        }
      }
    }
  }
  return issues
}

/** Run every check for an export selection. */
export function runChecks(document: StoreDocument, selection: ExportSelection, evaluate: SceneEvaluator): ComplianceIssue[] {
  const issues = [...targetRequirementIssues(selection), ...localeIssues(document, selection)]
  const wanted = new Set(selection.slideIds)
  const seen = new Set<string>()
  for (const choice of selection.targets) {
    const target = getStoreTarget(choice.targetId)
    if (!target) continue
    const size = targetPixelSize(target, choice.sizeIndex, choice.orientation)
    for (const locale of selection.locales) {
      document.slides.forEach((slide, index) => {
        if (!wanted.has(slide.id)) return
        const scene = evaluate(index, target, choice.sizeIndex, choice.orientation, locale)
        const base = { targetId: target.id, slideId: slide.id, locale }
        for (const issue of [...textIssues(scene, base, size.width / 1320), ...deviceIssues(document, scene, base)]) {
          const key = `${issue.code}:${issue.layerId}:${issue.locale ?? ''}:${issue.code === 'overflow' || issue.code === 'clipped' ? issue.targetId : ''}`
          if (seen.has(key)) continue
          seen.add(key)
          issues.push(issue)
        }
      })
    }
  }
  return issues
}

/** Counts by severity. */
export function countIssues(issues: ComplianceIssue[]): { requirements: number; recommendations: number } {
  return {
    requirements: issues.filter((issue) => issue.severity === 'requirement').length,
    recommendations: issues.filter((issue) => issue.severity === 'recommendation').length,
  }
}
