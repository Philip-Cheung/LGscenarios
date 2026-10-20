import { parseRichText, referencedPassages, richParagraphs, richTextProblems, richTextToPlain } from './richText'

const source = 'https://www.churchofjesuschrist.org/study/manual/first-vision-accounts/1832-account?lang=eng'

describe('parseRichText', () => {
  it('splits text into plain runs, passage references, and source links', () => {
    expect(parseRichText(`Read [James 1:5](ref:james-1-5) and the [1832 transcript](${source}).`)).toEqual([
      { kind: 'text', text: 'Read ' },
      { kind: 'ref', label: 'James 1:5', id: 'james-1-5' },
      { kind: 'text', text: ' and the ' },
      { kind: 'link', label: '1832 transcript', href: source },
      { kind: 'text', text: '.' },
    ])
  })

  it('leaves tokens with disallowed targets as plain text', () => {
    const text = 'See [this](https://example.com) and [that](javascript:alert(1)).'
    expect(parseRichText(text)).toEqual([{ kind: 'text', text }])
  })
})

describe('richParagraphs', () => {
  it('splits on blank lines and drops empty paragraphs', () => {
    expect(richParagraphs('One.\n\nTwo.\n  \n\nThree.')).toEqual(['One.', 'Two.', 'Three.'])
  })
})

describe('richTextToPlain and referencedPassages', () => {
  it('reduces tokens to their labels and lists passage ids', () => {
    const text = '[James 1:5](ref:james-1-5) and [1 John 4](ref:1-john-4).'
    expect(richTextToPlain(text)).toBe('James 1:5 and 1 John 4.')
    expect(referencedPassages(text)).toEqual(['james-1-5', '1-john-4'])
  })
})

describe('richTextProblems', () => {
  it('reports link-shaped tokens that are neither passages nor allowed https sources', () => {
    expect(richTextProblems(`[ok](ref:james-1-5) [ok](${source})`)).toEqual([])
    expect(richTextProblems('[bad](http://www.churchofjesuschrist.org/x)')).toHaveLength(1)
    expect(richTextProblems('[bad](https://example.com/x)')).toHaveLength(1)
  })
})
