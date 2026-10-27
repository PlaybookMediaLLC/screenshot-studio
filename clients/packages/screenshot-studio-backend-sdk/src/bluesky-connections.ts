import { z } from 'zod'
import {
  socialConnectionIntentSchema,
  socialOAuthOperationSchema,
  socialOAuthProviderSchema,
  socialOAuthStartOptionsSchema,
} from './social-oauth.ts'

/** Connection methods available for reconnect; OAuth and app-password submission stay separate. */
export const socialConnectionProviderSchema = z.enum([
  ...socialOAuthProviderSchema.options,
  'bluesky',
])

/** An opaque, high-entropy state; it never contains a password or an authorization URL. */
export const blueskyConnectionStateSchema = z.string().regex(/^[A-Za-z0-9_-]{32,512}$/)

/** The backend resolves this normalized hostname to the provider's immutable DID. */
export const blueskyHandleSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/^@/, '').toLowerCase())
  .pipe(
    z
      .string()
      .max(253)
      .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/)
      .refine(
        (value) =>
          ![
            'alt',
            'arpa',
            'example',
            'internal',
            'invalid',
            'local',
            'localhost',
            'onion',
            'test',
          ].includes(value.split('.').at(-1) ?? ''),
        'Enter a public Bluesky handle.'
      )
  )

/** Dedicated app-password syntax; the backend also checks the actual provider grant. */
export const blueskyAppPasswordSchema = z.string().regex(/^[a-z0-9]{4}(-[a-z0-9]{4}){3}$/)

/** Create a credential attempt without creating an empty social set. */
export const blueskyConnectionBeginSchema = socialConnectionIntentSchema
  .safeExtend({ operation: socialOAuthOperationSchema })
  .refine((input) => input.operation === 'CREATE_SET' || !!input.socialSetId, {
    message: 'Choose the social set this account belongs to.',
    path: ['socialSetId'],
  })

/** A persisted attempt, ready for one credential submission. */
export const blueskyConnectionBeginResponseSchema = z.object({
  state: blueskyConnectionStateSchema,
})

/** Credentials exist only in this POST body. Omitting them checks a saved result. */
export const blueskyConnectionCompleteSchema = z.strictObject({
  state: blueskyConnectionStateSchema,
  credentials: z
    .strictObject({ handle: blueskyHandleSchema, appPassword: blueskyAppPasswordSchema })
    .optional(),
})

/** Safe completion metadata for the original authorized workspace. */
export const blueskyConnectionCompleteResponseSchema = z.object({
  completed: z.literal(true),
  connectionId: z.string().min(1).max(160),
  socialSetId: z.string().min(1).max(160).nullable(),
  organizationId: z.string().min(1).max(160),
  returnPath: z.union([z.literal(''), socialOAuthStartOptionsSchema.shape.returnPath.unwrap()]),
})

/** A credential connection's immutable intent. */
export type BlueskyConnectionBegin = z.input<typeof blueskyConnectionBeginSchema>
/** A one-use credential submission or receipt-only recovery. */
export type BlueskyConnectionComplete = z.input<typeof blueskyConnectionCompleteSchema>
