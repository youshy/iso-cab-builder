import { compareVersion, design } from '../../model/store'
import { STEP_LABEL, matName, weight, weightCompare } from './data'

const kg = (n: number) => `${n.toFixed(1)} kg`
function delta(cur: number, prev: number | undefined) {
  if (prev === undefined) return null
  const d = Math.round((cur - prev) * 10) / 10
  return <span class="unit"> ({d > 0 ? '+' : d < 0 ? '−' : ''}{Math.abs(d).toFixed(1)} vs v{compareVersion.value})</span>
}

export function WeightPanel() {
  const w = weight.value
  const c = weightCompare.value
  const stepMax = Math.max(...w.byStep.map((s) => s.kg), 0.1)
  const matMax = Math.max(...w.byMaterial.map((m) => m.kg), 0.1)
  const heaviestCab = design.value.cabs.reduce((m, x) => Math.max(m, x.weightKg), 0)
  const bars = (rows: { label: string; kg: number }[], max: number) => (
    <div class="bars">
      {rows.map((r) => (
        <div class="bar" key={r.label}>
          <span class="bl">{r.label}</span>
          <span class="bt"><i style={`width:${Math.max(2, (r.kg / max) * 100)}%`} /></span>
          <span class="bv num">{kg(r.kg)}</span>
        </div>
      ))}
    </div>
  )
  return (
    <div class="weightpanel">
      <p class="hint">Estimate from material density and part sizes. Cabs are not in the build total.</p>
      <div class="wtotal">
        <b class="num">{kg(w.totalKg)}</b> build total{delta(w.totalKg, c?.totalKg)}
      </div>
      <h3>By build step</h3>
      {bars(w.byStep.map((s) => ({ label: STEP_LABEL[s.step], kg: s.kg })), stepMax)}
      <h3>By material</h3>
      {bars(w.byMaterial.map((m) => ({ label: matName(m.materialId), kg: m.kg })), matMax)}
      <table class="etable">
        <tbody>
          <tr><td>Hardware</td><td class="num">{kg(w.hardwareKg)}</td></tr>
          <tr><td>Heaviest single part</td><td class="num">{w.heaviestPart ? `${w.heaviestPart.name} (${w.heaviestPart.partId}), ${kg(w.heaviestPart.kg)}` : 'none'}</td></tr>
          <tr><td>Heaviest moving assembly</td><td class="num">{kg(w.movingAssemblyKg)}{delta(w.movingAssemblyKg, c?.movingAssemblyKg)}</td></tr>
          <tr><td>Box with heaviest cab ({kg(heaviestCab)})</td><td class="num">{kg(w.withHeaviestCabKg)}{delta(w.withHeaviestCabKg, c?.withHeaviestCabKg)}</td></tr>
        </tbody>
      </table>
    </div>
  )
}
