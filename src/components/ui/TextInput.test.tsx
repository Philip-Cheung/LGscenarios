import { render, screen } from '@testing-library/react'
import { TextInput } from './TextInput'

describe('TextInput', () => {
  it('labels the input and links the hint', () => {
    render(<TextInput label="Pair code" hint="Six characters" />)
    const input = screen.getByLabelText('Pair code')
    expect(input).toHaveAccessibleDescription('Six characters')
    expect(input).not.toHaveAttribute('aria-invalid')
  })

  it('announces errors and marks the input invalid', () => {
    render(<TextInput label="Pair code" hint="Six characters" error="That code is not valid" />)
    const input = screen.getByLabelText('Pair code')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('Six characters That code is not valid')
    expect(screen.getByRole('alert')).toHaveTextContent('That code is not valid')
  })
})
