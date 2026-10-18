import { ulid } from 'ulid'

/**
 * 客户端生成 id。
 *
 * 用 ULID 而不是自增整数：离线新建的章节必须立刻有稳定 id，
 * 否则联网后要做「本地 id → 服务器 id」重映射，那是同步系统里最脏的一类代码。
 * ULID 还天然按创建时间可排序。
 */
export const newId = (): string => ulid()
