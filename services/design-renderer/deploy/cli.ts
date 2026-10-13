import { readFile, writeFile, chmod } from 'node:fs/promises'
import { z } from 'zod'
import { deploymentEnvironmentSchema, renderSpec, verifyDeployment } from './spec.js'

try {
  const [command, inputPath, outputPath, previousId] = process.argv.slice(2)
  if (!inputPath || !outputPath)
    throw new Error('Usage: cli.ts render|verify input.json spec.json [previous-id]')
  const input: unknown = JSON.parse(await readFile(inputPath, 'utf8'))
  if (command === 'render') {
    const environment = deploymentEnvironmentSchema.safeParse(process.env)
    if (!environment.success) {
      throw new Error(
        `Missing or invalid configuration: ${environment.error.issues.map((issue) => issue.path.join('.')).join(', ')}`
      )
    }
    const spec = renderSpec(input, environment.data)
    await writeFile(outputPath, JSON.stringify(spec, null, 2) + '\n', { mode: 0o600 })
    await chmod(outputPath, 0o600)
    console.info('Prepared renderer deployment; unrelated components preserved.')
  } else if (command === 'verify') {
    const expected: unknown = JSON.parse(await readFile(outputPath, 'utf8'))
    const id = verifyDeployment(input, expected, previousId)
    console.info(
      `Verified active deployment ${id}; renderer digest matches and web image is unchanged.`
    )
  } else throw new Error('Expected render or verify.')
} catch (error) {
  // Never print Zod input data: the input spec can contain runtime credentials.
  console.error(
    error instanceof z.ZodError
      ? 'Invalid deployment data.'
      : error instanceof Error
        ? error.message
        : 'Deployment failed.'
  )
  process.exitCode = 1
}
