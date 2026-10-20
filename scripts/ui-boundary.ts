/** Packages that only the design-system wrapper layer may import. */
export const VENDOR_PACKAGES = ['@openai/apps-sdk-ui', 'tailwindcss', '@tailwindcss/', 'radix-ui', '@radix-ui/']

export const WRAPPER_DIR = 'src/components/ui/'
export const VENDOR_STYLESHEET = 'src/styles/vendor-theme.css'
export const TOKENS_STYLESHEET = 'src/styles/tokens.css'

export interface SourceFile {
  path: string
  content: string
}

const IMPORT_PATTERNS = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\s+['"]([^'"]+)['"]/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  /@import\s+(?:url\()?\s*['"]([^'"]+)['"]/g,
  /@source\s+['"]([^'"]+)['"]/g,
]

function isVendorSpecifier(specifier: string): boolean {
  return VENDOR_PACKAGES.some(
    (pkg) =>
      specifier === pkg ||
      specifier.startsWith(pkg.endsWith('/') ? pkg : `${pkg}/`) ||
      specifier.includes(`node_modules/${pkg}`),
  )
}

/**
 * Rejects vendor design-system imports outside the wrapper layer and the
 * single vendor stylesheet, and raw hex colours outside tokens.css.
 */
export function findBoundaryViolations(files: readonly SourceFile[]): string[] {
  const violations: string[] = []
  for (const file of files) {
    const path = file.path.replaceAll('\\', '/')
    const vendorAllowed = path.startsWith(WRAPPER_DIR) || path === VENDOR_STYLESHEET
    if (!vendorAllowed) {
      const specifiers = new Set<string>()
      for (const pattern of IMPORT_PATTERNS) {
        for (const match of file.content.matchAll(pattern)) {
          if (isVendorSpecifier(match[1])) specifiers.add(match[1])
        }
      }
      for (const specifier of specifiers) {
        violations.push(`${path}: imports "${specifier}"; use src/components/ui instead`)
      }
    }
    if (path.endsWith('.css') && path !== TOKENS_STYLESHEET) {
      for (const match of file.content.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
        violations.push(`${path}: raw colour ${match[0]}; add or use a token in ${TOKENS_STYLESHEET}`)
      }
    }
  }
  return violations
}
