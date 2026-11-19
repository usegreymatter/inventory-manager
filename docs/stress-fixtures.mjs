// Lifecycle: living. Pure offline fixture expansion; never imported by the plugin.
export function expandStressFixtures(fixtures) {
  return Object.fromEntries(Object.entries(fixtures).map(([name, fixture]) => {
    if (fixture.repeat === undefined) return [name, fixture]
    const { repeat, ...data } = fixture
    return [name, { ...data, items: Array.from({ length: repeat }, (_, index) => ({
      ...structuredClone(data.items[0]), sku: `${data.items[0].sku}-${String(index).padStart(4, '0')}`,
    })) }]
  }))
}
