/**
 * 正文哈希。用于跳过无意义的推送，以及识别「服务端发回来的就是我自己刚推的内容」。
 *
 * 需要安全上下文（https / localhost / app:// / https://localhost），
 * 这三种运行环境都满足。
 */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
