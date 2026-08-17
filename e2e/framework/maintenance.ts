const maintenanceSecretHeader = 'x-screenshot-studio-maintenance-secret'

export function getMaintenanceHeaders(): Record<string, string> {
  const secret = process.env.E2E_MAINTENANCE_SECRET
  if (!secret) {
    throw new Error('E2E_MAINTENANCE_SECRET must be set by the local stack command.')
  }

  return { [maintenanceSecretHeader]: secret }
}
