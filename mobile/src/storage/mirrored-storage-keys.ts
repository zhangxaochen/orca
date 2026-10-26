import AsyncStorage from '@react-native-async-storage/async-storage'

// Shell init is synchronous, so mirror stored keys in memory; page-reachable writes must use persistMirrored.
// Null records a known removal, distinct from an unhydrated key.
const mirror = new Map<string, string | null>()

let writeCount = 0

export function readMirroredStorage(keys: readonly string[]): Readonly<Record<string, string>> {
  const held: Record<string, string> = {}
  for (const key of keys) {
    const value = mirror.get(key)
    if (typeof value === 'string') {
      held[key] = value
    }
  }
  return held
}

// Failed hydration retains the last mirror for synchronous readers and retries on the next ask.
export async function hydrateMirroredStorage(keys: readonly string[]): Promise<void> {
  const startedAt = writeCount
  let pairs: readonly (readonly [string, string | null])[]
  try {
    pairs = await AsyncStorage.multiGet(keys)
  } catch {
    return
  }
  if (writeCount !== startedAt) {
    // Writes outrank an overlapping read; discard its stale snapshot and reread next time.
    return
  }
  for (const [key, value] of pairs) {
    // A store must not inject keys outside the requested route scope.
    if (keys.includes(key)) {
      mirror.set(key, value)
    }
  }
}

// Unlike bulk hydration, preserve store rejection so unavailable storage cannot masquerade as an unset key.
export async function readMirroredKeyOrStore(key: string): Promise<string | null> {
  const held = mirror.get(key)
  return held === undefined ? AsyncStorage.getItem(key) : held
}

type MirroredKeyListener = (value: string | null) => void
const keyListeners = new Map<string, Set<MirroredKeyListener>>()

export function subscribeMirroredKey(key: string, listener: MirroredKeyListener): () => void {
  const forKey = keyListeners.get(key) ?? new Set<MirroredKeyListener>()
  keyListeners.set(key, forKey)
  forKey.add(listener)
  return () => {
    forKey.delete(listener)
  }
}

function note(key: string, value: string | null): void {
  writeCount += 1
  mirror.set(key, value)
  for (const listener of keyListeners.get(key) ?? []) {
    listener(value)
  }
}

function isSubscribableStorage(value: object): value is {
  subscribe: (listener: (key: string, value: string | null) => void) => () => void
} {
  return 'subscribe' in value && typeof value.subscribe === 'function'
}

if (
  typeof AsyncStorage === 'object' &&
  AsyncStorage !== null &&
  isSubscribableStorage(AsyncStorage)
) {
  AsyncStorage.subscribe(note)
}

/**
 * The one way a mirrored key is written, and the only thing that notes the map (ruling 35).
 *
 * Noted on an accepted write and on nothing else. The store is what accepts: inside the page it is
 * the bridge's adapter, which refuses a key this route was never given and a value past the frame
 * cap, and on the device it is AsyncStorage, which refuses neither. Deciding here rather than in
 * fourteen writers is the whole point — twelve of them noted first and never looked again, so a
 * refused page write left this map holding a value no store had taken and the next `init` handed
 * the page exactly that. There is nothing to undo, because nothing is written until the answer.
 *
 * Returns the store's own promise so callers can report refusals.
 */
export function persistMirrored(key: string, value: string | null): Promise<void> {
  const write = value === null ? AsyncStorage.removeItem(key) : AsyncStorage.setItem(key, value)
  // Read back before noting: the page adapter can resolve a refused write, so requested value is not proof of persistence.
  return write
    .then(() => AsyncStorage.getItem(key))
    .then((stored) => {
      note(key, stored)
    })
}

// Native-shell-only: note before async storage so the next synchronous init sees the page’s accepted value.
// Page-reachable writers use persistMirrored because their adapter can refuse writes.
export function writeMirroredStorage(key: string, value: string | null): void {
  note(key, value)
  void (value === null ? AsyncStorage.removeItem(key) : AsyncStorage.setItem(key, value)).catch(
    () => {
      // A failed pin persistence must not take the workspace off screen.
    }
  )
}
