// "Viewed" ticks for PR files, kept on this phone. A file counts as viewed
// while its patchHash is in the PR's set, so a push that changes a file
// un-ticks exactly that file. Stored compactly in SecureStore (no extra
// native dependency): one small entry per PR plus an index for pruning.
import * as SecureStore from 'expo-secure-store'

export type ViewedState = { head: string; hashes: string[] }
const HASH_CHARS = 12
const KEY_INDEX = 'gitgud.viewed.index'
const KEY_FILTER = 'gitgud.pulls.filter'

/** SecureStore keys allow [A-Za-z0-9._-] only: hash the PR identity. */
export function viewedKey(forge: string, repo: string, number: number): string {
  const s = `${forge}|${repo}#${number}`
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return `gitgud.viewed.${h.toString(36)}.${number}`
}

export const shortHash = (patchHash: string) => patchHash.slice(0, HASH_CHARS)

export function progress(files: Array<{ patchHash: string }>, v: ViewedState | null): { viewed: number; total: number } {
  const set = new Set(v?.hashes ?? [])
  return { viewed: files.filter((f) => set.has(shortHash(f.patchHash))).length, total: files.length }
}

/** Toggle one file; hashes of files no longer in the PR are dropped. */
export function toggle(v: ViewedState | null, head: string, files: Array<{ patchHash: string }>, patchHash: string, on: boolean): ViewedState {
  const live = new Set(files.map((f) => shortHash(f.patchHash)))
  const set = new Set((v?.hashes ?? []).filter((h) => live.has(h)))
  if (on) set.add(shortHash(patchHash)); else set.delete(shortHash(patchHash))
  return { head, hashes: [...set] }
}

export function firstUnviewed<T extends { patchHash: string }>(files: T[], v: ViewedState | null): number {
  const set = new Set(v?.hashes ?? [])
  const i = files.findIndex((f) => !set.has(shortHash(f.patchHash)))
  return i < 0 ? 0 : i
}

// ── Storage ─────────────────────────────────────────────────────────────

export async function loadViewed(key: string): Promise<ViewedState | null> {
  try {
    const raw = await SecureStore.getItemAsync(key)
    if (!raw) return null
    const j = JSON.parse(raw) as { h?: unknown; s?: unknown }
    return typeof j.h === 'string' && Array.isArray(j.s) ? { head: j.h, hashes: j.s.filter((x): x is string => typeof x === 'string') } : null
  } catch { return null }
}

export async function saveViewed(key: string, v: ViewedState): Promise<void> {
  await SecureStore.setItemAsync(key, JSON.stringify({ h: v.head, s: v.hashes }))
  const idx = await loadIndex()
  if (!idx.includes(key)) await SecureStore.setItemAsync(KEY_INDEX, JSON.stringify([...idx, key]))
}

async function loadIndex(): Promise<string[]> {
  try { const j = JSON.parse((await SecureStore.getItemAsync(KEY_INDEX)) ?? '[]'); return Array.isArray(j) ? j.filter((x): x is string => typeof x === 'string') : [] } catch { return [] }
}

/** Forget PRs that are no longer open (called with the inbox's keys). */
export async function pruneViewed(openKeys: Set<string>): Promise<void> {
  const idx = await loadIndex()
  const keep = idx.filter((k) => openKeys.has(k))
  if (keep.length === idx.length) return
  for (const k of idx) if (!openKeys.has(k)) await SecureStore.deleteItemAsync(k).catch(() => {})
  await SecureStore.setItemAsync(KEY_INDEX, JSON.stringify(keep))
}

export type PullFilter = 'all' | 'review'
export async function loadFilter(): Promise<PullFilter> {
  return (await SecureStore.getItemAsync(KEY_FILTER).catch(() => null)) === 'review' ? 'review' : 'all'
}
export async function saveFilter(f: PullFilter): Promise<void> {
  await SecureStore.setItemAsync(KEY_FILTER, f).catch(() => {})
}
