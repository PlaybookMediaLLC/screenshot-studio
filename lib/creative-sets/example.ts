import { createCreativeSet } from './recipes'

/** The explicitly labelled example uses the same native formats as saved sets. */
export const exampleStorySet = (() => {
  let id = 0
  const set = createCreativeSet(
    {
      headline: 'Your team’s work, together',
      supporting: '',
      treatment: 'product-hero',
      focus: { x: 0, y: 0, width: 1, height: 1 },
      source: {
        id: 'example-source',
        src: 'asset:00000000-0000-4000-8000-000000000000',
        name: 'Example product screenshot',
        revision: 1,
        width: 1600,
        height: 987,
      },
    },
    () => `example-${++id}`
  )
  for (const output of set.outputs) output.document.image.src = '/demo/notion-showcase.webp'
  return set
})()
