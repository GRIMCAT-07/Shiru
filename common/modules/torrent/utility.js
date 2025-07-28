import { createHash } from 'crypto'
import { base32toHex } from '../util.js'
import querystring from 'querystring'
import bencode from 'bencode'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

export const ANNOUNCE = [
  atob('d3NzOi8vdHJhY2tlci5vcGVud2VidG9ycmVudC5jb20='),
  atob('d3NzOi8vdHJhY2tlci53ZWJ0b3JyZW50LmRldg=='),
  atob('d3NzOi8vdHJhY2tlci5maWxlcy5mbTo3MDczL2Fubm91bmNl'),
  atob('d3NzOi8vdHJhY2tlci5idG9ycmVudC54eXov'),
  atob('dWRwOi8vb3Blbi5zdGVhbHRoLnNpOjgwL2Fubm91bmNl'),
  atob('aHR0cDovL255YWEudHJhY2tlci53Zjo3Nzc3L2Fubm91bmNl'),
  atob('dWRwOi8vdHJhY2tlci5vcGVudHJhY2tyLm9yZzoxMzM3L2Fubm91bmNl'),
  atob('dWRwOi8vZXhvZHVzLmRlc3luYy5jb206Njk2OS9hbm5vdW5jZQ=='),
  atob('dWRwOi8vdHJhY2tlci5jb3BwZXJzdXJmZXIudGs6Njk2OS9hbm5vdW5jZQ=='),
  atob('dWRwOi8vOS5yYXJiZy50bzoyNzEwL2Fubm91bmNl'),
  atob('dWRwOi8vdHJhY2tlci50b3JyZW50LmV1Lm9yZzo0NTEvYW5ub3VuY2U='),
  atob('aHR0cDovL29wZW4uYWNnbnh0cmFja2VyLmNvbTo4MC9hbm5vdW5jZQ=='),
  atob('aHR0cDovL2FuaWRleC5tb2U6Njk2OS9hbm5vdW5jZQ=='),
  atob('aHR0cDovL3RyYWNrZXIuYW5pcmVuYS5jb206ODAvYW5ub3VuY2U=')
]

export let TMP
try {
  TMP = path.join(fs.statSync('/tmp') && '/tmp', 'webtorrent')
} catch (err) {
  TMP = path.join(typeof os.tmpdir === 'function' ? os.tmpdir() : '/', 'webtorrent')
}

export function toBase64(data) {
  return Buffer.from(data).toString('base64')
}

export function fromBase64(buffer) {
  return Uint8Array.from(Buffer.from(buffer, 'base64'))
}

export const stringifyQuery = obj => {
  let ret = querystring.stringify(obj, null, null, { encodeURIComponent: escape })
  ret = ret.replace(/[@*/+]/g, char => // `escape` doesn't encode the characters @*/+ so we do it manually
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return ret
}

export function errorToString (e) {
  if (typeof Event !== 'undefined' && e instanceof Event) {
    if (e.error) return errorToString(e.error)
    if (e.message) return errorToString(e.message)
    if (e.reason) return errorToString(e.reason)
    return JSON.stringify(e)
  }
  if (typeof Error !== 'undefined' && e instanceof Error) {
    if (e.message) return errorToString(e.message)
    if (e.cause) return errorToString(e.cause)
    if (e.reason) return errorToString(e.reason)
    if (e.name) return errorToString(e.name)
    return JSON.stringify(e)
  }
  if (typeof e !== 'string') return JSON.stringify(e)
  return e
}

export async function saveTorrent(torrentCache, infoHash, data) {
  if (!torrentCache || !infoHash || !data) return
  await fs.writeFile(path.join(torrentCache, infoHash), JSON.stringify(data, null, 2))
}

export async function getTorrent(torrentCache, torrent, torrentHash) {
  if (!torrentCache || (!torrent?.length && !torrentHash?.length)) return null
  try {
    const content = await fs.readFile(path.join(torrentCache, torrentHash || (await getInfoHash(torrent))), 'utf8')
    return JSON.parse(content)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

export async function getTorrents(torrentCache) {
  try {
    const results = []
    for (const fileName of (await fs.readdir(torrentCache, { withFileTypes: true })).filter(entry => entry.isFile() && /^[a-f0-9]{40}$/.test(entry.name)).map(entry => entry.name)) {
      try {
        const filePath = path.join(torrentCache, fileName)
        const content = await fs.readFile(filePath, 'utf8')
        results.push(JSON.parse(content))
      } catch (err) {
        if (err.code !== 'ENOENT') debug(`Skipping invalid JSON file ${fileName}:`, err.message)
      }
    }
    return results
  } catch (err) {
    debug('Failed to read torrent cache directory:', err.message)
    return []
  }
}

export async function removeTorrent(folder, fileName) {
  try {
    await fs.unlink(path.join(folder, fileName))
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
}

export async function isVerified(targetPath, _structureHash) {
  if (!_structureHash) return false
  try {
    return (await structureHash(targetPath)) === _structureHash
  } catch (error) {
    return false
  }
}

export function getHash(data) {
  return createHash('sha1').update(data).digest('hex')
}

export async function structureHash(targetPath) {
  try {
    const stat = await fs.stat(targetPath)
    if (stat.isFile()) return createHash('sha1').update(`${path.basename(targetPath)}:${stat.size}:${stat.mtimeMs}`).digest('hex')
    const hash = createHash('sha1')
    const files = []
    async function walk(dir) {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            await walk(fullPath)
          } else if (entry.isFile()) {
            const fileStat = await fs.stat(fullPath)
            files.push(`${path.relative(targetPath, fullPath)}:${fileStat.size}:${fileStat.mtimeMs}`)
          }
        }
    }
    await walk(targetPath)
    files.sort()
    for (const entry of files) hash.update(entry)
    return hash.digest('hex')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

const torrentHashes = JSON.parse(localStorage.getItem('torrentHashes')) || {}
/**
 * @param {any} input
 * @param {any} og_input
 * @returns {Promise<string>}
 */
export async function getInfoHash(input, og_input) {
  if (typeof input === 'string' && torrentHashes?.[input]) return torrentHashes?.[input]
  if (typeof input === 'string') {
    if (input.startsWith('magnet:')) {
      const match = input.match(/btih:([a-fA-F0-9]{40}|[a-zA-Z0-9]{32})/)
      if (!match) throw new Error('Invalid magnet URI')
      let hash = match[1].toLowerCase()
      if (hash.length === 32) hash = base32toHex(hash)
      torrentHashes[input] = hash
      localStorage.setItem('torrentHashes', JSON.stringify(torrentHashes))
      return hash
    } else if (input.startsWith('http') || input.endsWith('.torrent')) {
      const res = await fetch(input)
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`)
        const buf = new Uint8Array(await res.arrayBuffer())
        return getInfoHash(buf, input)
    }
    throw new Error('Unsupported string format')
  } else {
    const meta = bencode.decode(input)
    if (!meta?.info) throw new Error('Missing info section in torrent file')
      const infoBuf = bencode.encode(meta.info)
      const infoBufHash = createHash('sha1').update(infoBuf).digest('hex')
      if (og_input) {
        torrentHashes[og_input] = infoBufHash
        localStorage.setItem('torrentHashes', JSON.stringify(torrentHashes))
      }
    return infoBufHash
  }
}