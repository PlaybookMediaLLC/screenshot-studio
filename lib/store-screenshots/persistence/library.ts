import { brandKitSchema, type BrandKit } from '../brand-kits'
import { templateSchema, type StoreTemplate } from '../templates'
import { deleteRecord, getAllRecords, putRecord, STORES } from './db'

/**
 * The cross-project library: brand kits and saved templates. Records list
 * the asset ids they use so unused-image cleanup never removes them.
 */

type BrandKitRecord = { id: string; kit: unknown; assetIds: string[] }
type TemplateRecord = { id: string; template: unknown; assetIds: string[] }

/** Saved brand kits, newest first. Invalid records are skipped. */
export async function listBrandKits(): Promise<BrandKit[]> {
  const records = await getAllRecords<BrandKitRecord>(STORES.brandKits)
  return records
    .flatMap((record) => {
      const parsed = brandKitSchema.safeParse(record.kit)
      return parsed.success ? [parsed.data] : []
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Create or update a brand kit. */
export async function saveBrandKit(kit: BrandKit): Promise<BrandKit> {
  const saved = brandKitSchema.parse({ ...kit, updatedAt: Date.now() })
  await putRecord(STORES.brandKits, { id: saved.id, kit: saved, assetIds: saved.assets.map((asset) => asset.id) } satisfies BrandKitRecord)
  return saved
}

/** Delete a brand kit. */
export async function deleteBrandKit(id: string): Promise<void> {
  await deleteRecord(STORES.brandKits, id)
}

/** Saved templates. */
export async function listSavedTemplates(): Promise<StoreTemplate[]> {
  const records = await getAllRecords<TemplateRecord>(STORES.templates)
  return records.flatMap((record) => {
    const parsed = templateSchema.safeParse(record.template)
    return parsed.success ? [parsed.data] : []
  })
}

/** Save a template. */
export async function saveTemplate(template: StoreTemplate): Promise<void> {
  const parsed = templateSchema.parse(template)
  await putRecord(STORES.templates, { id: parsed.id, template: parsed, assetIds: [] } satisfies TemplateRecord)
}

/** Delete a saved template. */
export async function deleteTemplate(id: string): Promise<void> {
  await deleteRecord(STORES.templates, id)
}
