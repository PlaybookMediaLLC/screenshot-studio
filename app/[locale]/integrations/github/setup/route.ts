import { continueGitHubSetup, githubSettingsUrl } from '@/lib/tenant/github'

/** GitHub's setup URL: verify the installation through the user's own authorization. */
export async function GET(request: Request): Promise<Response> {
  let destination: string
  try {
    destination = await continueGitHubSetup(request.headers, new URL(request.url).searchParams)
  } catch {
    destination = githubSettingsUrl('failed')
  }
  return new Response(null, {
    headers: { 'Cache-Control': 'no-store', Location: destination },
    status: 303,
  })
}
