/**
 * Writes content/scenario.schema.json from the Zod scenario file schema so
 * editors can autocomplete and check scenario JSON while it is being written.
 *
 *   npm run scenario:schema
 */
import { writeFileSync } from 'node:fs'
import { buildJsonSchema } from './jsonSchema'
import { JSON_SCHEMA_PATH } from './scenarios'

writeFileSync(JSON_SCHEMA_PATH, buildJsonSchema())
console.log('Wrote content/scenario.schema.json')
