import { z } from 'zod'

function normalizedName(value: string): string {
  return value.replace(/^[\p{White_Space}\uFEFF]+|[\p{White_Space}\uFEFF]+$/gu, '').normalize('NFC')
}

/** Validate Unicode names without rewriting a previously submitted retry payload. */
export const workspaceNameInputSchema = z.string().superRefine((value, ctx) => {
  const name = normalizedName(value)
  const length = Array.from(name).length
  const invalid =
    /[\uD800-\uDFFF\uFFFD]/u.test(name) ||
    /[\p{Cc}\p{Cf}]/u.test(name.replace(/[\u200c\u200d]/gu, ''))
  const visible = /[^\p{White_Space}\p{M}\p{Cf}\uFEFF]/u.test(name)
  if (length < 2 || length > 100 || invalid || !visible) {
    ctx.addIssue({
      code: 'custom',
      message:
        'Use 2–100 characters with visible text, without control or directional formatting characters.',
    })
  }
})

/** NFC display name; names may repeat and never identify ownership or retries. */
export const workspaceNameSchema = workspaceNameInputSchema.transform(normalizedName)
