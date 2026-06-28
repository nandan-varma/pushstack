import { Readable } from 'node:stream'
import { server } from '../dist/server/server.js'

export default async function handler(req, res) {
  const proto = req.headers['x-forwarded-proto'] ?? 'https'
  const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost'
  const url = new URL(req.url, `${proto}://${host}`)

  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : v)
  }

  const hasBody = !['GET', 'HEAD'].includes(req.method)
  const request = new Request(url, {
    method: req.method,
    headers,
    ...(hasBody ? { body: Readable.toWeb(req), duplex: 'half' } : {}),
  })

  const response = await server.fetch(request)

  res.statusCode = response.status

  // Forward headers, handling multi-value Set-Cookie correctly
  response.headers.forEach((v, k) => res.setHeader(k, v))
  if (typeof response.headers.getSetCookie === 'function') {
    const cookies = response.headers.getSetCookie()
    if (cookies.length > 1) res.setHeader('set-cookie', cookies)
  }

  if (response.body) {
    Readable.fromWeb(response.body).pipe(res)
  } else {
    res.end()
  }
}
