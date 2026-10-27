import { z } from 'zod'

/** Refuse credentials and non-origin URLs before placing a server in a request query. */
export const socialInstanceServerSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((server) => {
    try {
      if (/[\\?#%]/.test(server)) return false
      // URL normalizes an explicit :443 away; the server rejects every supplied port.
      if (
        server
          .replace(/^https:\/\//, '')
          .split('/')[0]
          .includes(':')
      )
        return false
      const url = new URL(server.includes('://') ? server : `https://${server}`)
      return (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.port &&
        url.pathname === '/' &&
        url.hostname.includes('.') &&
        !url.hostname.endsWith('.') &&
        !/^[\d.]+$/.test(url.hostname) &&
        !url.hostname.endsWith('.local') &&
        !url.hostname.endsWith('.localhost')
      )
    } catch {
      return false
    }
  }, 'Enter a public HTTPS server hostname without a path, port, or credentials.')

/** The Go service revalidates syntax and checks the actual network address before connecting. */
export const socialInstanceQuerySchema = z.strictObject({ server: socialInstanceServerSchema })

/** Public Mastodon v2 metadata. The count means active users in the past four weeks. */
export const mastodonInstanceSchema = z.object({
  origin: z.url({ protocol: /^https$/ }),
  title: z.string().min(1).max(160),
  description: z.string().max(1200),
  activeUsers: z.number().int().nonnegative().nullable(),
  authorizationEnabled: z.boolean().default(false),
})
