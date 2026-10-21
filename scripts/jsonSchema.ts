import { z } from 'zod'
import { scenarioFileJsonSchemaSource } from '../src/lib/content'

/** JSON Schema text for scenario files. Plain-text and cross-id rules are enforced by Zod only. */
export function buildJsonSchema(): string {
  const schema = z.toJSONSchema(scenarioFileJsonSchemaSource, { io: 'input', unrepresentable: 'any' })
  return `${JSON.stringify({ title: 'Doorstep practice scenario', ...schema }, null, 2)}\n`
}
