import Dexie, { type Table } from 'dexie'

import { DB_VERSION, STORES, type LocalChapter, type LocalNovel, type MetaEntry } from './schema'

export class WriterDB extends Dexie {
  novels!: Table<LocalNovel, string>
  chapters!: Table<LocalChapter, string>
  meta!: Table<MetaEntry, string>

  constructor() {
    super('writer')
    this.version(DB_VERSION).stores(STORES)
  }
}

export const db = new WriterDB()

/** 登出 / 换账号时必须清库，否则会串数据。 */
export async function wipeLocalData(): Promise<void> {
  await db.transaction('rw', db.novels, db.chapters, db.meta, async () => {
    await db.novels.clear()
    await db.chapters.clear()
    await db.meta.clear()
  })
}
