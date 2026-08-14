import { task } from '@trigger.dev/sdk'

export const localHealth = task({
  id: 'local-health',
  run: async (): Promise<{ status: 'ok' }> => ({ status: 'ok' }),
})
