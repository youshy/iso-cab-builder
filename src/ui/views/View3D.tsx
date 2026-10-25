import { signal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import {
  AmbientLight, BufferGeometry, Color, DirectionalLight, DoubleSide, EdgesGeometry, Float32BufferAttribute,
  Group, LineBasicMaterial, LineSegments, Material, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, Vector3, WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { doorWall } from '../../doors/side'
import { resolveDims } from '../../geometry/dimensions'
import { buildScene, type Solid } from '../../geometry/mesh'
import { wallNormal } from '../../geometry/walls'
import type { Design, WallId } from '../../model/schema'
import { library } from '../../model/store'
import { Seg } from '../Seg'

export type Mode3D = 'solid' | 'cutaway' | 'exploded'
type Props = { design: Design; highlight?: WallId; mode: Mode3D }

const EXPLODE = 80
const REBUILD_DELAY = 50
const HIGH: WallId[] = ['right', 'top', 'front']
// Flat greys approximating the token palette (--bg, --line-strong, --ink-3, --accent).
const BG = '#f7f6f3'
const COLOR = { door: '#cdbfa8', shell: '#dedbd5', liner: '#c4c0b8', facet: '#9a968f', accent: '#b45a2c', cab: '#6f6c66', edge: '#5d5a54' }

function hidden(s: Solid, mode: Mode3D, door: WallId): boolean {
  if (mode !== 'cutaway') return false
  // The top and door walls come away whole: shells, liners, facets and the door leaves.
  const wallPart = s.kind === 'shell' || s.kind === 'liner' || s.kind === 'door'
  return (wallPart && (s.wall === 'top' || s.wall === door)) || (s.kind === 'facet' && s.wall === 'top')
}

function toMesh(s: Solid, color: string, opacity: number, offset: Vector3 | null): Group {
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(s.vertices, 3))
  geo.setIndex(s.indices)
  const mat = new MeshStandardMaterial({
    color: new Color(color), flatShading: true, side: DoubleSide, roughness: 0.9, metalness: 0,
    transparent: opacity < 1, opacity, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  })
  const g = new Group()
  g.add(new Mesh(geo, mat))
  g.add(new LineSegments(new EdgesGeometry(geo, 20), new LineBasicMaterial({ color: COLOR.edge })))
  if (offset) g.position.copy(offset)
  return g
}

function solidStyle(s: Solid, highlight?: WallId): [string, number] {
  switch (s.kind) {
    case 'shell': return [COLOR.shell, 1]
    case 'liner': return [COLOR.liner, 1]
    case 'facet': return [s.wall === highlight ? COLOR.accent : COLOR.facet, 1]
    case 'door': return [COLOR.door, 1]
    case 'cab': return [COLOR.cab, 0.55]
    default: return [COLOR.facet, 1]
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

export function View3D({ design, highlight, mode }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const three = useRef<{ group: Group; draw: () => void; fit: (size: Vector3, center: Vector3) => void; fitted: boolean } | null>(null)

  useEffect(() => {
    const el = host.current!
    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ antialias: true })
    } catch {
      el.textContent = '3D view needs WebGL, which is not available here.'
      return
    }
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
      group, draw, fitted: false,
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
      for (const s of buildScene(design, library.value).solids) {
        if (hidden(s, mode, door)) continue
        let offset: Vector3 | null = null
        if (mode === 'exploded' && s.wall) {
          offset = new Vector3()
          const n = wallNormal(s.wall)
          offset[n] = HIGH.includes(s.wall) ? EXPLODE : -EXPLODE
        }
        const [color, opacity] = solidStyle(s, highlight)
        t.group.add(toMesh(s, color, opacity, offset))
      }
      if (!t.fitted) {
        t.fitted = true
        const { outer, inner } = resolveDims(design)
        t.fit(new Vector3(outer.x, outer.y, outer.z), new Vector3(inner.x / 2, inner.y / 2, inner.z / 2))
      }
      t.draw()
    }, REBUILD_DELAY)
    return () => clearTimeout(timer)
  }, [design, highlight, mode, library.value])

  return <div ref={host} class="view3d" role="img" aria-label="3D view of the box. Drag to orbit, scroll to zoom." />
}

const mode3d = signal<Mode3D>('solid')

/** View3D with its mode control overlaid. */
export function View3DPanel({ design, highlight }: { design: Design; highlight?: WallId }) {
  return (
    <div class="view view3dpanel">
      <span class="lbl">3D view</span>
      <div class="view3dmode">
        <Seg
          label="3D mode"
          value={mode3d.value}
          options={[['solid', 'Solid'], ['cutaway', 'Cut-away'], ['exploded', 'Exploded']]}
          onPick={(m) => (mode3d.value = m)}
        />
      </div>
      <View3D design={design} highlight={highlight} mode={mode3d.value} />
    </div>
  )
}

