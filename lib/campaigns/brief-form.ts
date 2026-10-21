import type { ZodError } from 'zod'

const FIELD_LABELS: Record<string, string> = {
  title: 'Release title',
  benefitStatement: 'Why it matters',
  description: 'Description',
  audience: 'Target audience',
  sourceUrls: 'Source links',
  name: 'Product name',
  url: 'App URL',
}

export function briefValidationMessage(error: ZodError): string {
  return error.issues
    .map(
      (issue) => `${FIELD_LABELS[String(issue.path[0])] ?? issue.path.join('.')}: ${issue.message}`
    )
    .join(' ')
}

export function normalizeProductUrl(value: string): string {
  const trimmed = value.trim()
  return trimmed && !/^[a-z][a-z\d+.-]*:/i.test(trimmed) ? `https://${trimmed}` : trimmed
}
