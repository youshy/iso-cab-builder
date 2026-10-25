import { z } from 'zod'
import { LibrarySchema, ProjectSchema, ShopSchema } from '../model/schema'
import type { Library, Project, Shop } from '../model/schema'

type Backend = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const K_PROJECTS = 'isocab:projects'
const K_LIBRARY = 'isocab:library'
const K_SHOP = 'isocab:shop'
const projectKey = (id: string) => `isocab:project:${id}`

export function createStore(backend: Backend | null) {
  const mem = new Map<string, string>()
  const b: Backend = backend ?? {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => void mem.set(k, v),
    removeItem: (k) => void mem.delete(k),
  }
  const store = { ok: true }

  function read<T>(key: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T | null {
    try {
      const raw = b.getItem(key)
      if (raw === null) return null
      const parsed = schema.safeParse(JSON.parse(raw))
      return parsed.success ? parsed.data : null
    } catch {
      store.ok = false
      return null
    }
  }

  function write(key: string, value: unknown): boolean {
    try {
      b.setItem(key, JSON.stringify(value))
      return true
    } catch {
      store.ok = false
      return false
    }
  }

  const ids = (): string[] => read(K_PROJECTS, z.array(z.string())) ?? []

  return {
    get ok() {
      return store.ok
    },
    loadProjects(): Project[] {
      const out: Project[] = []
      for (const id of ids()) {
        const p = read(projectKey(id), ProjectSchema)
        if (p) out.push(p)
      }
      return out
    },
    saveProject(p: Project): boolean {
      if (!write(projectKey(p.id), p)) return false
      const list = ids()
      return list.includes(p.id) ? true : write(K_PROJECTS, [...list, p.id])
    },
    deleteProject(id: string): void {
      try {
        b.removeItem(projectKey(id))
      } catch {
        store.ok = false
      }
      write(K_PROJECTS, ids().filter((x) => x !== id))
    },
    loadLibrary: (): Library | null => read(K_LIBRARY, LibrarySchema),
    saveLibrary: (l: Library): boolean => write(K_LIBRARY, l),
    loadShop: (): Shop | null => read(K_SHOP, ShopSchema),
    saveShop: (s: Shop): boolean => write(K_SHOP, s),
  }
}
