import { describe, expect, it } from 'vitest'
import { materialSwatch } from './palette'

const lum = (hex: string) => parseInt(hex.slice(3, 5), 16)

describe('materialSwatch', () => {
  it('is deterministic per material id', () => {
    expect(materialSwatch('mdf', 'sheet')).toEqual(materialSwatch('mdf', 'sheet'))
  })

  it('tells the default sheet materials apart', () => {
    expect(materialSwatch('plywood', 'sheet').color).not.toBe(materialSwatch('mdf', 'sheet').color)
  })

  it('makes rolls darker than any sheet and fills see-through', () => {
    const roll = materialSwatch('mlv', 'roll')
    for (const id of ['plywood', 'mdf', 'osb', 'a', 'b', 'c', 'd']) expect(lum(roll.color)).toBeLessThan(lum(materialSwatch(id, 'sheet').color))
    expect(materialSwatch('rockwool', 'fill').opacity).toBeLessThan(1)
  })
})
