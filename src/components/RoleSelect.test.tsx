import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RoleSelect } from './RoleSelect'

describe('RoleSelect', () => {
  it('offers two equal role cards with a description', async () => {
    const onChoose = vi.fn()
    render(<RoleSelect busyRole={null} error={null} onChoose={onChoose} />)
    expect(screen.getByRole('heading', { name: 'Choose your role' })).toBeInTheDocument()
    const missionary = screen.getByRole('button', { name: /Mormon missionary/ })
    const christian = screen.getByRole('button', { name: /Christian/ })
    expect(missionary).toHaveTextContent('Read the prompts and guide the conversation.')
    expect(christian).toHaveTextContent('Practise your response. Reveal an answer if needed.')

    await userEvent.click(missionary)
    expect(onChoose).toHaveBeenCalledWith('missionary')
  })
})