import { db } from './db'

export const META_CURSOR = 'cursor'
export const META_USER_ID = 'user_id'
export const META_INFLIGHT_OP = 'inflight_op'

export interface InflightOp {
  opId: string
  /** push payload + cursor 的指纹。只有指纹一致时才能复用 op_id。 */
  fingerprint: string
}

async function read<T>(key: string, fallback: T): Promise<T> {
  const entry = await db.meta.get(key)
  return entry === undefined ? fallback : (entry.value as T)
}

async function write(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value })
}

export const getCursor = () => read<number>(META_CURSOR, 0)
export const setCursor = (v: number) => write(META_CURSOR, v)

export const getStoredUserId = () => read<string | null>(META_USER_ID, null)
export const setStoredUserId = (v: string | null) => write(META_USER_ID, v)

export const getInflightOp = () => read<InflightOp | null>(META_INFLIGHT_OP, null)
export const setInflightOp = (v: InflightOp | null) => write(META_INFLIGHT_OP, v)
