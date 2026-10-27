import { z } from 'zod'

/** An installation the user can link, offered when their GitHub account reaches several. */
export const githubInstallationChoiceSchema = z.object({
  accountLogin: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/),
  id: z.number().int().positive(),
})

/** One of {@link githubInstallationChoiceSchema}. */
export type GitHubInstallationChoice = z.infer<typeof githubInstallationChoiceSchema>

/** The choices on the settings URL: `id:login` pairs, comma-separated. */
export const githubChoicesParamSchema = z
  .string()
  .max(4_000)
  .transform((value) =>
    value.split(',').map((pair) => {
      const [id, accountLogin] = pair.split(':')
      return { accountLogin, id: Number(id) }
    })
  )
  .pipe(z.array(githubInstallationChoiceSchema).min(2).max(100))

/** The single-use state the user's pick is tied to. */
export const githubChoiceStateSchema = z.string().regex(/^[A-Za-z0-9_-]{20,200}$/)
