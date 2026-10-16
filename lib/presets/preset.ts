import { z } from 'zod'
import { type DesignDocument, parseDesignDocument } from '@/lib/design/document'

/**
 * Saved presets: a design's reusable structure (layout, frame, background,
 * typography, annotations, elements, effects, and motion) without the
 * project's own screenshots, so it can be applied to any screenshot.
 *
 * Presets are stored as workspace creative templates, versioned by name. A
 * template whose definition is not a design preset (a campaign template) is
 * not shown in the editor.
 */

/** The `kind` of a creative template definition that holds an editor preset. */
export const DESIGN_PRESET_KIND = 'design-preset'

/** A creative template definition holding a preset. The document is read with {@link parseDesignDocument}. */
export const presetDefinitionSchema = z.object({
  document: z.record(z.string(), z.unknown()),
  kind: z.literal(DESIGN_PRESET_KIND),
})

/** A stored creative template, as listed by the workspace. */
export const creativeTemplateSchema = z.object({
  createdAt: z.coerce.date(),
  definition: z.record(z.string(), z.unknown()),
  id: z.string(),
  name: z.string(),
  status: z.string(),
  version: z.number().int(),
})
/** A stored creative template. */
export type CreativeTemplate = z.infer<typeof creativeTemplateSchema>

/** A preset the editor can apply: the latest version of one name. */
export type DesignPreset = {
  createdAt: Date
  document: DesignDocument
  id: string
  name: string
  version: number
}

/**
 * The library: the latest version of each name, newest first, leaving out
 * archived presets and templates that are not editor presets.
 */
export function presetLibrary(templates: readonly CreativeTemplate[]): DesignPreset[] {
  const latest = new Map<string, CreativeTemplate>()
  for (const template of templates) {
    const current = latest.get(template.name)
    if (!current || template.version > current.version) latest.set(template.name, template)
  }
  const presets: DesignPreset[] = []
  for (const template of latest.values()) {
    if (template.status === 'ARCHIVED') continue
    const definition = presetDefinitionSchema.safeParse(template.definition)
    if (!definition.success) continue
    try {
      presets.push({
        createdAt: template.createdAt,
        document: parseDesignDocument(definition.data.document),
        id: template.id,
        name: template.name,
        version: template.version,
      })
    } catch {
      // A preset saved by a newer editor, or damaged: skip rather than break the list.
    }
  }
  return presets.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

/**
 * The reusable structure of a design: the main screenshot, device screen
 * images, slides, and blur regions (which cover that screenshot's content)
 * are left out. Backgrounds, overlays, and logos stay: they are part of the look.
 */
export function presetFromDocument(document: DesignDocument): DesignDocument {
  const { slides: _slides, ...rest } = document
  const { name: _name, ...image } = document.image
  return {
    ...rest,
    devices: document.devices && {
      ...document.devices,
      mockups: document.devices.mockups.map(
        ({ screen: { name: _screenName, ...screen }, ...mockup }) => ({
          ...mockup,
          screen: { ...screen, src: null },
        })
      ),
    },
    image: { ...image, src: null },
    redactions: [],
  }
}

/**
 * A preset applied to a project: the preset's structure around the project's
 * own screenshot, device screen images (by position), slides, and blur regions.
 */
export function applyPresetTo(preset: DesignDocument, project: DesignDocument): DesignDocument {
  const screens = project.devices?.mockups ?? []
  return {
    ...preset,
    devices: preset.devices && {
      ...preset.devices,
      mockups: preset.devices.mockups.map((mockup, index) => {
        const screen = screens[index]?.screen
        return screen?.src
          ? { ...mockup, screen: { ...mockup.screen, name: screen.name, src: screen.src } }
          : mockup
      }),
    },
    image: { ...preset.image, name: project.image.name, src: project.image.src },
    redactions: project.redactions,
    slides: project.slides,
  }
}

const jsonObject = z.record(z.string(), z.json())

/** A value as plain JSON (undefined fields dropped), checked. */
export function toJsonObject(value: object): z.infer<typeof jsonObject> {
  return jsonObject.parse(JSON.parse(JSON.stringify(value)))
}

/** A stored definition for a document, ready for `creativeTemplate.create`. */
export function presetDefinition(document: DesignDocument): z.infer<typeof jsonObject> {
  return toJsonObject({ document: presetFromDocument(document), kind: DESIGN_PRESET_KIND })
}

/** A free name for a copy: "Hero copy", then "Hero copy 2", and so on. */
export function copyName(name: string, taken: ReadonlySet<string>): string {
  const base = `${name} copy`.slice(0, 100)
  if (!taken.has(base)) return base
  for (let index = 2; ; index++) {
    const candidate = `${name.slice(0, 100 - ` copy ${index}`.length)} copy ${index}`
    if (!taken.has(candidate)) return candidate
  }
}
