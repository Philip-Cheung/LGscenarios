import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { findBoundaryViolations, type SourceFile } from './ui-boundary'

const root = process.cwd()

function collect(dir: string, files: SourceFile[] = []): SourceFile[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      collect(full, files)
    } else if (/\.(tsx?|css)$/.test(entry)) {
      files.push({ path: relative(root, full), content: readFileSync(full, 'utf8') })
    }
  }
  return files
}

const violations = findBoundaryViolations(collect(join(root, 'src')))
if (violations.length > 0) {
  console.error('Design-system boundary violations:\n' + violations.map((v) => `  - ${v}`).join('\n'))
  process.exit(1)
}
console.log('Design-system boundary check passed.')
