import type { FrontendObservation, FrontendPolicy } from 'screenshot-studio-backend-sdk'

/** Illustrative evidence for the dry run; these examples never enter live ingestion. */
export function deploymentExample(
  provider: string,
  scenario: string,
  policy: FrontendPolicy
): FrontendObservation {
  const at = new Date().toISOString()
  const observation: FrontendObservation = {
    provider,
    accountId: 'example-account',
    projectId: 'example-project',
    key: 'example',
    providerEventId: 'example-event',
    kind: 'example.activation',
    deploymentId: 'example-deployment',
    activationId: 'example-activation',
    activationKey: '',
    environment: policy.environments[0] ?? 'production',
    branch: policy.branch,
    tag: policy.tag,
    revision: 'example-revision',
    repositoryId: 'example-repository',
    repositoryName: '',
    runId: '',
    runAttempt: 0,
    workflowId: '',
    jobId: '',
    job: '',
    workflowLinked: false,
    url: policy.domain ? `https://${policy.domain}` : '',
    status: 'success',
    build: 'success',
    production: 'active',
    rollback: false,
    occurredAt: at,
    activationObservedAt: null,
    checks: policy.checks.map((rule) => ({
      source: rule.source,
      id: 'example-check',
      name: rule.name,
      appId: rule.appId,
      repositoryId: 'example-repository',
      revision: 'example-revision',
      deploymentId: 'example-deployment',
      status: 'completed',
      conclusion: rule.passing[0] ?? 'success',
      occurredAt: at,
    })),
    evidence: ['Illustrative normalized evidence, not a real provider event.'],
  }
  if (scenario === 'preview') observation.environment = 'preview'
  if (scenario === 'build') observation.production = 'pending'
  if (scenario === 'workflow') {
    observation.kind = 'workflow_run'
    observation.production = ''
    observation.deploymentId = ''
  }
  if (scenario === 'rollback') {
    observation.rollback = true
    observation.production = 'pending'
  }
  if (scenario === 'missing-check') observation.checks = []
  if (scenario === 'failed-check')
    observation.checks =
      observation.checks?.map((check) => ({ ...check, conclusion: 'failure' })) ?? []
  if (scenario === 'wrong-revision')
    observation.checks =
      observation.checks?.map((check) => ({
        ...check,
        revision: 'another-revision',
        deploymentId: 'another-deployment',
      })) ?? []
  return observation
}
