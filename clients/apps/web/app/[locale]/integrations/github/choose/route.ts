import { chooseGitHubInstallation, githubSettingsUrl } from '@/lib/tenant/github'

/** Link the installation the user picked after GitHub verified their access to several. */
export async function GET(request: Request): Promise<Response> {
  let destination: string
  try {
    destination = await chooseGitHubInstallation(request.headers, new URL(request.url).searchParams)
  } catch {
    destination = githubSettingsUrl('failed')
  }
  return new Response(null, {
    headers: { 'Cache-Control': 'no-store', Location: destination },
    status: 303,
  })
}
