import { NextRequest, NextResponse } from 'next/server'
import { entitlementSyncSchema, syncWorkspaceEntitlement } from '@/lib/billing/entitlements'
import { verifyBillingSignature } from '@/lib/billing/signature'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.text()
  if (
    !verifyBillingSignature(
      body,
      request.headers.get('x-screenshot-studio-signature'),
      process.env.BILLING_ENTITLEMENT_WEBHOOK_SECRET ?? ''
    )
  ) {
    return NextResponse.json({ error: 'Unauthorized billing event.' }, { status: 401 })
  }

  try {
    const result = await syncWorkspaceEntitlement(entitlementSyncSchema.parse(JSON.parse(body)))
    return NextResponse.json(result, { status: result.replayed ? 200 : 202 })
  } catch (error) {
    const status =
      error instanceof Error && 'status' in error && typeof error.status === 'number'
        ? error.status
        : 400
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid billing event.' },
      { status }
    )
  }
}
