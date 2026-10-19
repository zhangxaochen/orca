import AsyncStorage from '@react-native-async-storage/async-storage'
import { persistMirrored } from '../storage/mirrored-storage-keys'
import type { CustomKey } from './CustomKeyModal'

export const CUSTOM_ACCESSORY_KEYS_STORAGE_KEY = 'orca:custom-accessory-keys'

// Throws on a failed read or parse, so a write never starts from an empty list it made up.
export async function readStoredCustomKeys(): Promise<CustomKey[]> {
  const raw = await AsyncStorage.getItem(CUSTOM_ACCESSORY_KEYS_STORAGE_KEY)
  return raw ? (JSON.parse(raw) as CustomKey[]) : []
}

export function loadCustomKeys(): Promise<CustomKey[]> {
  return readStoredCustomKeys().catch(() => [])
}

export function writeCustomKeys(keys: CustomKey[]): Promise<void> {
  // Through the one write path, which notes the mirror on an accepted write and on nothing else
  // (ruling 35). There is no rollback here any more because there is nothing to undo: on the page
  // a value over the cap rejects, and a rejected write never reached the map.
  return persistMirrored(CUSTOM_ACCESSORY_KEYS_STORAGE_KEY, JSON.stringify(keys))
}

// Every write to the stored list takes a turn here, so a settings save, an add and a removal never
// land over one that started first, and an add or removal reads what the last write saved.
let customKeysWriteTurn: Promise<unknown> = Promise.resolve()

export function inCustomKeysWriteTurn<T>(write: () => Promise<T>): Promise<T> {
  const run = customKeysWriteTurn.then(write)
  customKeysWriteTurn = run.catch(() => {})
  return run
}

export function saveCustomKeys(keys: CustomKey[]): Promise<void> {
  return inCustomKeysWriteTurn(() => writeCustomKeys(keys))
}

export function updateStoredCustomKeys(
  change: (keys: CustomKey[]) => CustomKey[]
): Promise<CustomKey[]> {
  return inCustomKeysWriteTurn(async () => {
    const updated = change(await readStoredCustomKeys())
    await writeCustomKeys(updated)
    return updated
  })
}

// Like addKey: resolves with the stored list only once the store took it, so a refused write
// never drops a row from screen that the next load would bring back.
export function removeCustomKey(id: string): Promise<CustomKey[]> {
  return updateStoredCustomKeys((keys) => keys.filter((key) => key.id !== id))
}
