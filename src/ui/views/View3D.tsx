import { useEffect, useRef, useState } from 'preact/hooks'
import {
  AmbientLight, BufferGeometry, Color, DirectionalLight, DoubleSide, EdgesGeometry, Float32BufferAttribute,
  Group, LineBasicMaterial, LineSegments, Material, Mesh, MeshStandardMaterial, PerspectiveCamera, Plane, Scene, Vector3, WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { doorWall } from '../../doors/side'
import { resolveDims } from '../../geometry/dimensions'
import { buildScene, type Solid } from '../../geometry/mesh'
import { wallNormal, wallStack, WALLS } from '../../geometry/walls'
import type { Design, Library, WallId } from '../../model/schema'
import { library } from '../../model/store'
import { Seg } from '../Seg'
import { materialSwatch } from './palette'

export type Mode3D = 'solid' | 'cutaway' | 'exploded' | 'section'
type Props = { design: Design; highlight?: WallId; mode: Mode3D; /** Changing this number refits the camera. */ fitRequest?: number }

const EXPLODE = 80
/** Refit the camera when the outer box diagonal changes by more than this fraction since the last fit. */
const REFIT_CHANGE = 0.1
const REBUILD_DELAY = 50
const HIGH: WallId[] = ['right', 'top', 'front']
// Flat greys approximating the token palette (--bg, --line-strong, --ink-3, --accent).
const BG = '#f7f6f3'
const COLOR = { door: '#cdbfa8', facet: '#9a968f', accent: '#b45a2c', cab: '#6f6c66', front: '#2f2d2a', treatment: '#c9bfae', edge: '#5d5a54' }

/** Whether the box grew or shrank enough since the last camera fit to fit it again. */
export function needsRefit(prevDiag: number, nextDiag: number): boolean {
  if (prevDiag <= 0) return true
  return Math.abs(nextDiag - prevDiag) / prevDiag > REFIT_CHANGE
}

function hidden(s: Solid, mode: Mode3D, door: WallId): boolean {
  if (mode !== 'cutaway') return false
  // The top and door walls come away whole: shells, liners, facets, treatments and the door leaves.
  const wallPart = s.kind === 'layer' || s.kind === 'door'
  return (wallPart && (s.wall === 'top' || s.wall === door)) || ((s.kind === 'facet' || s.kind === 'treatment') && s.wall === 'top')
}

type Look = { color: string; opacity: number; edge: string }

function toMesh(s: Solid, look: Look, offset: Vector3 | null, clip: Plane[] | null): Group {
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(s.vertices, 3))
  geo.setIndex(s.indices)
  const mat = new MeshStandardMaterial({
    color: new Color(look.color), flatShading: true, side: DoubleSide, roughness: 0.9, metalness: 0,
    transparent: look.opacity < 1, opacity: look.opacity, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    clippingPlanes: clip ?? undefined, clipIntersection: true,
  })
  const line = new LineBasicMaterial({ color: look.edge, clippingPlanes: clip ?? undefined, clipIntersection: true })
  const g = new Group()
  g.add(new Mesh(geo, mat))
  g.add(new LineSegments(new EdgesGeometry(geo, 20), line))
  if (offset) g.position.copy(offset)
  return g
}

function solidLook(s: Solid, lib: Library, highlight?: WallId): Look {
  const edge = s.kind === 'layer' && s.wall === highlight ? COLOR.accent : COLOR.edge
  switch (s.kind) {
    case 'layer': {
      const kind = lib.materials.find((m) => m.id === s.materialId)?.kind
      return { ...materialSwatch(s.materialId ?? '', kind), edge }
    }
    case 'facet': return { color: s.wall === highlight ? COLOR.accent : COLOR.facet, opacity: 1, edge }
    case 'door': return { color: COLOR.door, opacity: 1, edge }
    case 'cab': if (s.name === 'cab-front') return { color: COLOR.front, opacity: 0.95, edge }
      return { color: COLOR.cab, opacity: 0.55, edge }
    case 'treatment': return { color: COLOR.treatment, opacity: 0.85, edge }
    default: return { color: COLOR.facet, opacity: 1, edge }
  }
}

function disposeGroup(g: Group) {
  g.traverse((o) => {
    const x = o as Mesh
    x.geometry?.dispose()
    const m = x.material as Material | Material[] | undefined
    if (Array.isArray(m)) m.forEach((k) => k.dispose())
    else m?.dispose()
  })
  g.clear()
}

export function View3D({ design, highlight, mode, fitRequest = 0 }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const three = useRef<{ group: Group; draw: () => void; fit: (size: Vector3, center: Vector3) => void; fittedDiag: number } | null>(null)
  const fitDesign = (t: NonNullable<typeof three.current>, d: Design) => {
    const { outer, inner } = resolveDims(d)
    const size = new Vector3(outer.x, outer.y, outer.z)
    t.fittedDiag = size.length()
    t.fit(size, new Vector3(inner.x / 2, inner.y / 2, inner.z / 2))
  }

  useEffect(() => {
    const el = host.current!
    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ antialias: true })
    } catch {
      el.textContent = '3D view needs WebGL, which is not available here.'
      return
    }
    renderer.localClippingEnabled = true
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(new Color(BG))
    el.appendChild(renderer.domElement)
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%'

    const scene = new Scene()
    const camera = new PerspectiveCamera(35, 1, 10, 100000)
    scene.add(new AmbientLight(0xffffff, 1.1))
    const sun = new DirectionalLight(0xffffff, 2)
    sun.position.set(-1, 2, 1.5)
    scene.add(sun)
    const group = new Group()
    scene.add(group)

    let frame = 0
    const draw = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        renderer.render(scene, camera)
      })
    }
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.addEventListener('change', draw)

    const size = () => {
      const w = Math.max(el.clientWidth, 1), h = Math.max(el.clientHeight, 1)
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      draw()
    }
    const ro = new ResizeObserver(size)
    ro.observe(el)
    size()

    three.current = {
      group, draw, fittedDiag: 0,
      fit(dim, center) {
        const r = dim.length() / 2
        const dist = (1.15 * r) / Math.sin((camera.fov * Math.PI) / 360) / Math.min(1, camera.aspect)
        controls.target.copy(center)
        camera.position.copy(center).add(new Vector3(0.9, 0.6, 1.4).normalize().multiplyScalar(dist))
        camera.far = dist * 10
        camera.updateProjectionMatrix()
        controls.update()
      },
    }

    return () => {
      three.current = null
      cancelAnimationFrame(frame)
      ro.disconnect()
      controls.dispose()
      disposeGroup(group)
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      const t = three.current
      if (!t) return
      disposeGroup(t.group)
      const door = doorWall(design)
      const lib = library.value
      const { inner } = resolveDims(design)
      // Section: clip away the corner where x, y and z are all past the middle (intersection of three half-spaces).
      const clip = mode === 'section'
        ? [new Plane(new Vector3(-1, 0, 0), inner.x / 2), new Plane(new Vector3(0, -1, 0), inner.y / 2), new Plane(new Vector3(0, 0, -1), inner.z / 2)]
        : null
      for (const s of buildScene(design, lib).solids) {
        if (hidden(s, mode, door)) continue
        let offset: Vector3 | null = null
        if (mode === 'exploded' && s.wall) {
          offset = new Vector3()
          const n = wallNormal(s.wall)
          offset[n] = HIGH.includes(s.wall) ? EXPLODE : -EXPLODE
        }
        t.group.add(toMesh(s, solidLook(s, lib, highlight), offset, clip))
      }
      const { outer: o } = resolveDims(design)
      if (needsRefit(t.fittedDiag, Math.hypot(o.x, o.y, o.z))) fitDesign(t, design)
      t.draw()
    }, REBUILD_DELAY)
    return () => clearTimeout(timer)
  }, [design, highlight, mode, library.value])

  useEffect(() => {
    const t = three.current
    if (!t || fitRequest === 0) return
    fitDesign(t, design)
    t.draw()
  }, [fitRequest])

  return <div ref={host} class="view3d" role="img" aria-label="3D view of the box. Drag to orbit, scroll to zoom." />
}

const MODES: [Mode3D, string][] = [['solid', 'Solid'], ['section', 'Section'], ['cutaway', 'Cut-away'], ['exploded', 'Exploded']]

/** Wall layer materials in use, for the legend. */
function usedMaterials(d: Design, lib: Library) {
  const ids = new Set<string>()
  for (const w of WALLS) for (const i of wallStack(d, w)) if (i.kind === 'layer') ids.add(i.materialId)
  return [...ids].map((id) => {
    const m = lib.materials.find((x) => x.id === id)
    return { id, name: m?.name ?? 'Missing material', ...materialSwatch(id, m?.kind) }
  })
}

/** View3D with its mode control and material legend overlaid. */
export function View3DPanel({ design, highlight, initial = 'solid' }: { design: Design; highlight?: WallId; initial?: Mode3D }) {
  const [mode, setMode] = useState<Mode3D>(initial)
  const [fitRequest, setFitRequest] = useState(0)
  const mats = usedMaterials(design, library.value)
  return (
    <div class="view view3dpanel">
      <span class="lbl">3D view</span>
      <div class="view3dmode">
        <Seg label="3D mode" value={mode} options={MODES} onPick={setMode} />
        <button type="button" class="btn" onClick={() => setFitRequest((n) => n + 1)}>Fit view</button>
      </div>
      <View3D design={design} highlight={highlight} mode={mode} fitRequest={fitRequest} />
      <ul class="legend3d" aria-label="Wall materials">
        {mats.map((m) => (
          <li key={m.id}>
            <i style={{ background: m.color, opacity: m.opacity }} />
            {m.name}
          </li>
        ))}
      </ul>
    </div>
  )
}
