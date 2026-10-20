import { describe, expect, it } from 'vitest'
import { findBoundaryViolations } from './ui-boundary'

describe('findBoundaryViolations', () => {
  it('rejects vendor imports inside the ui primitives too', () => {
    expect(
      findBoundaryViolations([
        { path: 'src/components/ui/Button.tsx', content: "import { Button } from '@openai/apps-sdk-ui/components/Button'" },
      ]),
    ).toHaveLength(1)
  })

  it('allows plain imports', () => {
    expect(
      findBoundaryViolations([{ path: 'src/components/ui/Button.tsx', content: "import styles from './Button.module.css'" }]),
    ).toEqual([])
  })

  it('rejects vendor stylesheets imported by path from app CSS', () => {
    expect(
      findBoundaryViolations([
        { path: 'src/styles/app.css', content: "@import '../../node_modules/@openai/apps-sdk-ui/dist/es/styles/base.css';" },
      ]),
    ).toHaveLength(1)
  })

  it('rejects vendor imports from feature code and app CSS', () => {
    const violations = findBoundaryViolations([
      { path: 'src/components/PromptCard.tsx', content: "import { Button } from '@openai/apps-sdk-ui/components/Button'" },
      { path: 'src/app/App.tsx', content: "const ui = import('@radix-ui/react-dialog')" },
      { path: 'src/styles/app.css', content: "@import 'tailwindcss';" },
    ])
    expect(violations).toHaveLength(3)
  })

  it('rejects raw hex colours outside tokens.css', () => {
    expect(findBoundaryViolations([{ path: 'src/styles/tokens.css', content: '--x: #181818;' }])).toEqual([])
    expect(findBoundaryViolations([{ path: 'src/components/x.module.css', content: 'color: #fff;' }])).toHaveLength(1)
  })
})
