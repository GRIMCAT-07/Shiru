import { join } from 'path'
import { mkdir, readFile, writeFile, unlink, access, readdir } from 'fs/promises'
import parseTorrent from 'parse-torrent'
import bencode from 'bencode'

const binaryKeys = new Set(['bitfield'])
export default class TorrentStore {

  /**
   * Creates a new TorrentStore instance with a cache folder inside the given torrent path.
   * @param {string} torrentPath - Base path where the cache folder will be created, this SHOULD be where webtorrent is storing its files!
   */
  constructor(torrentPath) {
    const targetPath = join(torrentPath, 'shiru-cache')
    this.cacheFolder = mkdir(targetPath, { recursive: true }).then(() => targetPath)
  }

  /**
   * Reads and decodes a stored torrent entry by key.
   * @param {string} key - The key (filename) to read.
   * @returns {Promise<Object|null>} Decoded stored object or null if not found/error.
   */
  async get(key) {
    if (!key) return null
    try {
      const data = await readFile(join(await this.cacheFolder, key))
      if (!data.length) return null
      let decoded
      try {
        decoded = bencode.decode(data)
      } catch {
        decoded = JSON.parse(data.toString('utf-8')) // fallback for JSON data.
      }
      try {
        const parsed = await parseTorrent(data)
        const customFields = {}
        for (const [key, value] of Object.entries(decoded)) {
          if (!(key in parsed)) {
            customFields[key] = value
          }
        }
        return {...parsed, ...customFields}
      } catch (error) {
        const store = this.#decodeStore(decoded)
        return { ...store, _bitfield: store.bitfield, info: Uint8Array.from(Buffer.from(store.torrentFile, 'base64')), legacy: true } // fallback for base64 torrentFile.
      }
    } catch {
      return null
    }
  }

  /**
   * Encodes and writes a value to storage by key.
   * @param {string} key - The key (filename) to write.
   * @param {Object} value - The value to encode and store.
   * @param {boolean} bencoded - Whether the data should be bencoded or not, bencode is used by default.
   * @returns {Promise<void>}
   */
  async set(key, value, bencoded = true) {
    try {
      return await writeFile(join(await this.cacheFolder, key), bencoded ? bencode.encode(value) : JSON.stringify(value), { mode: 0o666 })
    } catch (error) {
      console.error(error)
    }
  }

  /**
   * Deletes a stored entry by key.
   * @param {string} key - The key (filename) to delete.
   * @param {string|Promise<string>} [path] - Optional path to override the default cache folder, typically for the webtorrent folder.
   * @returns {Promise<void|null>}
   */
  async delete(key, path = null) {
    try {
      return await unlink(join(await path ?? await this.cacheFolder, key))
    } catch {
      return null
    }
  }

  /**
   * Checks if a stored entry exists by key.
   * @param {string} key - The key (filename) to check.
   * @param {string|Promise<string>} [path] - Optional path to override the default cache folder, typically for the webtorrent folder.
   * @returns {Promise<boolean>} True if exists, false otherwise.
   */
  async exists(key, path = null) {
    try {
      await access(join(await path ?? await this.cacheFolder, key))
      return true
    } catch {
      return false
    }
  }

  /**
   * Async generator yielding all stored entries.
   * @yields {Object} Each decoded stored entry.
   */
  async *entries() {
    try {
      for (const file of (await readdir(await this.cacheFolder, { withFileTypes: true }))) {
        if (!file.isDirectory()) {
          const res = await this.get(file.name)
          if (res) yield res
        }
      }
    } catch (error) {
      console.error(error)
    }
  }

  /**
   * Lists all keys (filenames) in the cache folder.
   * @returns {Promise<string[]>} Array of keys.
   */
  async list() {
    try {
      return (await readdir(await this.cacheFolder, { withFileTypes: true })).filter(item => !item.isDirectory()).map(({ name }) => name)
    } catch {
      return []
    }
  }

  /**
   * Decodes a bencoded object from storage, converting Uint8Arrays to strings or numbers as needed.
   * @param {Object} decoded - The bencoded decoded object.
   * @returns {Object} Processed object with proper types.
   * @private
   */
  #decodeStore(decoded) {
    const obj = {}
    for (const [key, value] of Object.entries(decoded)) {
      if (binaryKeys.has(key)) obj[key] = value
      else if (value instanceof Uint8Array) {
        let str = Buffer.from(value).toString()
        if (/^-?\d+$/.test(str)) str = Number(str)
        obj[key] = str
      } else obj[key] = value
    }
    return obj
  }
}