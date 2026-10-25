import type { Vec3 } from '../model/schema';

export type Mode = {
  f: number;
  n: [number, number, number];
  kind: 'axial' | 'tangential' | 'oblique';
};

/** Rigid-wall rectangular room modes up to fMax (Hz). `inner` is in mm. */
export function rectModes(inner: Vec3, fMax: number, c = 343): Mode[] {
  const L = [inner.x / 1000, inner.y / 1000, inner.z / 1000];
  const max = L.map((l) => Math.floor((2 * fMax * l) / c));
  const out: Mode[] = [];
  for (let nx = 0; nx <= max[0]; nx++)
    for (let ny = 0; ny <= max[1]; ny++)
      for (let nz = 0; nz <= max[2]; nz++) {
        if (nx + ny + nz === 0) continue;
        const f = (c / 2) * Math.sqrt((nx / L[0]) ** 2 + (ny / L[1]) ** 2 + (nz / L[2]) ** 2);
        if (f > fMax) continue;
        const nonZero = (nx > 0 ? 1 : 0) + (ny > 0 ? 1 : 0) + (nz > 0 ? 1 : 0);
        out.push({
          f,
          n: [nx, ny, nz],
          kind: nonZero === 1 ? 'axial' : nonZero === 2 ? 'tangential' : 'oblique',
        });
      }
  return out.sort((a, b) => a.f - b.f);
}
