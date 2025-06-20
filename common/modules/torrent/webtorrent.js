import WebTorrent from 'webtorrent'
import Client from 'bittorrent-tracker'
import HTTPTracker from 'bittorrent-tracker/lib/client/http-tracker.js' //../../node_modules/bittorrent-tracker/lib/client/http-tracker.js
import { hex2bin, arr2hex, text2arr } from 'uint8-util'
import { toBase64, fromBase64, saveTorrent, getTorrent, getTorrents, removeTorrent, isVerified, structureHash, stringifyQuery, errorToString, ANNOUNCE, TMP } from './utility.js'
import { fontRx, deepEqual, sleep, subRx, videoRx } from '../util.js'
import { SUPPORTS } from '@/modules/support.js'
import { spawn } from 'node:child_process'
import Parser from '../parser.js'
import Debug from 'debug'
const debug = Debug('torrent:worker')

import fs from 'fs/promises'
import path from 'path'

// HACK: this is https only, but electron doesn't run in https, weird.
if (!globalThis.FileSystemFileHandle) globalThis.FileSystemFileHandle = false

export default class TorrentClient extends WebTorrent {
  player = ''
  /** @type {ReturnType<spawn>} */
  playerProcess = null

  constructor (ipc, storageQuota, serverMode, settings, controller) {
    debug(`Initializing TorrentClient with settings: ${JSON.stringify(settings)}`)
    super({
      dht: settings.dht,
      maxConns: settings.maxConns,
      downloadLimit: settings.downloadLimit,
      uploadLimit: settings.uploadLimit,
      torrentPort: settings.torrentPort,
      dhtPort: settings.dhtPort,
      natUpnp: SUPPORTS.permamentNAT ? 'permanent' : true
    })
    this.settings = settings
    this.player = settings.playerPath
    this.ipc = ipc
    this.torrentCache = path.join(this.settings.torrentPathNew || TMP || '', 'shiru-cache')
    fs.mkdir(this.torrentCache, { recursive: true })
    ipc.send('torrentRequest')
    this._ready = new Promise(resolve => {
      ipc.on('port', ({ ports }) => {
        if (this.destroyed) return
        this.message = ports[0].postMessage.bind(ports[0])
        ports[0].onmessage = ({ data }) => {
          debug(`Received IPC message ${data.type}: ${data.data}`)
          this.handleMessage({ data })
        }
        resolve()
      })
      ipc.on('destroy', this.destroy.bind(this))
    })

    this.serverMode = serverMode
    this.storageQuota = storageQuota
    this.currentFile = null

    setInterval(() => {
      if (this.destroyed) return
      const currentTorrent = this.torrents.find(torrent => torrent.current)
      this.dispatch('stats', {
        numPeers: currentTorrent?.numPeers || 0,
        uploadSpeed: currentTorrent?.uploadSpeed || 0,
        downloadSpeed: currentTorrent?.downloadSpeed || 0
      })
    }, 200)
    setInterval(() => {
      if (this.destroyed) return
      const currentTorrent = this.torrents.find(torrent => torrent.current)
      if (currentTorrent?.pieces) this.dispatch('progress', this.currentFile?.progress)
      this.dispatch('activity', {
        current: {
          infoHash: currentTorrent?.infoHash,
          name: currentTorrent?.name,
          size: currentTorrent?.length,
          progress: currentTorrent?.progress,
          numSeeders: currentTorrent?.seeders || 0,
          numLeechers: currentTorrent?.leechers || 0,
          numPeers: currentTorrent?.numPeers || 0,
          downloadSpeed: currentTorrent?.downloadSpeed || 0,
          uploadSpeed: currentTorrent?.uploadSpeed || 0,
          eta: currentTorrent?.timeRemaining,
          ratio: currentTorrent?.ratio
        },
        staging: this.torrents.filter(torrent => torrent.staging).reverse().map(torrent => ({
          infoHash: torrent.infoHash,
          name: torrent.name,
          size: torrent.length,
          progress: torrent.progress,
          numSeeders: torrent.seeders || 0,
          numLeechers: torrent.leechers || 0,
          numPeers: torrent.numPeers,
          downloadSpeed: torrent.downloadSpeed,
          uploadSpeed: torrent.uploadSpeed,
          eta: torrent.timeRemaining,
          ratio: torrent.ratio
        })),
        seeding: this.torrents.filter(torrent => torrent.seeding).reverse().map(torrent => ({
          infoHash: torrent.infoHash,
          name: torrent.name,
          size: torrent.length,
          progress: torrent.progress,
          numSeeders: torrent.seeders || 0,
          numLeechers: torrent.leechers || 0,
          numPeers: torrent.numPeers,
          downloadSpeed: torrent.downloadSpeed,
          uploadSpeed: torrent.uploadSpeed,
          ratio: torrent.ratio
        }))
      })
    }, 2000)

    const createServer = controller => {
      this.server = this.createServer({ controller }, serverMode)
      this.server.listen(0, () => {})
    }
    if (controller) controller.then(createServer)
    else createServer()

    this.tracker = new HTTPTracker({}, atob('aHR0cDovL255YWEudHJhY2tlci53Zjo3Nzc3L2Fubm91bmNl'))
    process.on('uncaughtException', this.dispatchError.bind(this))
    this.on('error', this.dispatchError.bind(this))
  }

  async loadLastTorrent (torrent) {
    debug('Loading last torrent: ' + torrent)
    if (!torrent?.length) return
    const cache = await getTorrent(this.torrentCache, torrent)
    const skipVerify = cache?.torrentFile && (await isVerified(path.join(cache.path, cache.name), cache.structureHash))
    if (torrent) this.addTorrent(cache?.torrentFile ? fromBase64(cache?.torrentFile) : torrent, torrent, skipVerify)
  }

  async torrentReady (torrent) {
    if (this.destroyed) return
    debug('Got torrent metadata: ' + torrent.name)
    const files = torrent.files.map(file => {
      return {
        infoHash: torrent.infoHash,
        torrent_name: torrent.name,
        name: file.name,
        type: file.type,
        size: file.size,
        path: file.path,
        url: this.serverMode === 'node' ? 'http://localhost:' + this.server.address().port + file.streamURL : file.streamURL
      }
    })
    this.dispatch('files', files)
    this.dispatch('magnet', { magnet: torrent.magnetURI, hash: torrent.infoHash })
    setTimeout(() => {
      if (this.destroyed || torrent.destroyed) return
      if (torrent.progress !== 1) {
        if (torrent.numPeers === 0) this.dispatchError('No peers found for torrent, try using a different torrent.')
      }
    }, 30000).unref?.()
  }

  async findFontFiles (targetFile) {
    const files = this.torrents.find(torrent => torrent.current)?.files
    const fontFiles = files.filter(file => fontRx.test(file.name))
    const map = {}

    // deduplicate fonts
    // some releases have duplicate fonts for diff languages
    // if they have different chars, we can't find that out anyways
    // so some chars might fail, on REALLY bad releases
    for (const file of fontFiles) map[file.name] = file
    debug(`Found ${Object.keys(map).length} font files`)

    for (const file of Object.values(map)) {
      const data = await file.arrayBuffer()
      if (targetFile !== this.currentFile) return
      this.dispatch('file', { data: new Uint8Array(data) }, [data])
    }
  }

  async findSubtitleFiles (targetFile) {
    const files = this.torrents.find(torrent => torrent.current)?.files
    const videoFiles = files.filter(file => videoRx.test(file.name))
    const videoName = targetFile.name.substring(0, targetFile.name.lastIndexOf('.')) || targetFile.name
    // array of subtitle files that match video name, or all subtitle files when only 1 vid file
    const subfiles = files.filter(file => subRx.test(file.name) && (videoFiles.length === 1 ? true : file.name.includes(videoName)))
    debug(`Found ${subfiles?.length} subtitle files`)
    for (const file of subfiles) {
      const data = await file.arrayBuffer()
      if (targetFile !== this.currentFile) return
      this.dispatch('subtitleFile', { name: file.name, data: new Uint8Array(data) }, [data])
    }
  }

  async addTorrent (data, og_data, skipVerify = false, recover = false) {
    if (this.destroyed || !data) return
    debug('Adding torrent: ' + data)
    const currentTorrent = this.torrents.find(torrent => torrent.current)
    if (currentTorrent) await this.promoteTorrent(currentTorrent, currentTorrent.progress === 1, 'current')
    const existing = await this.get(data)
    if (existing) {
      existing.staging = false
      existing.seeding = false
      existing.current = true
      this.dispatch('loaded', { id: !recover ? og_data || data : existing.torrentFile, infoHash: existing.infoHash })
      if (existing.ready) this.torrentReady(existing)
      return
    }
    const torrent = await this.add(data, {
      private: this.settings.torrentPeX,
      path: this.settings.torrentPathNew || undefined,
      skipVerify,
      announce: ANNOUNCE,
      deselect: this.settings.torrentStreamedDownload
    })
    torrent.current = true
    torrent.once('verified', () => {
      if (this.destroyed) return
      if (!torrent.ready && !skipVerify) this.dispatch('info', 'Detected already downloaded files. Verifying file integrity. This might take a minute...')
    })
    torrent.once('ready', () => {
      this.dispatch('loaded', { id: !recover ? og_data || data : torrent.torrentFile, infoHash: torrent.infoHash })
      this.bindTracker(torrent)
      this.torrentReady(torrent)
    })
    torrent.once('done', async () => this.promoteTorrent(torrent, skipVerify))
    setTimeout(() => {
      if (this.destroyed || torrent.destroyed || skipVerify) return
      if (!torrent.progress && !torrent.ready) {
        if (torrent.numPeers === 0) this.dispatchError('No peers found for torrent, try using a different torrent.')
      }
    }, 30000).unref?.()
  }

  async stageTorrent(data, og_data, skipVerify = false, type) {
    if (this.destroyed || !data) return
    debug('Staging torrent: ' + data)
    if (await this.get(data)) {
      if (!skipVerify && type !== 'stage' && type !== 'seed' && type !== 'rescan') this.dispatch('info', 'This torrent is already queued and downloading in the background...')
      return
    }
    const torrent = await this.add(data, {
      private: this.settings.torrentPeX,
      path: this.settings.torrentPathNew || undefined,
      skipVerify, // Would only ever be a torrent previously seeding...
      announce: ANNOUNCE,
      deselect: false
    })
    torrent.staging = true
    torrent.once('verified', async () => {
      if (this.destroyed) return
      if (torrent.length > await this.storageQuota(torrent.path)) this.dispatchError('File Too Big! This File Exceeds The Selected Drive\'s Available Space. Change Download Location In Torrent Settings To A Drive With More Space And Restart The App!')
      else if (!skipVerify && type !== 'stage' && type !== 'seed' && type !== 'rescan') this.dispatch('info', 'Torrent queued for background download. Check the management page for progress...')
      if (this.settings.torrentStreamedDownload && this.currentFile && this.currentFile.progress !== 1) {
        for (const file of torrent.files) {
          if (!file._destroyed && file.selected) file.deselect()
        }
      }
    })
    torrent.once('ready', () => {
      if (!skipVerify || type !== 'stage') this.dispatch('staging', torrent.infoHash)
      this.bindTracker(torrent)
      this.promoteTorrent(torrent, skipVerify, type)
    })
    torrent.once('done', () => this.promoteTorrent(torrent, skipVerify, type))
  }

  async seedTorrent(torrent, type) {
    if (!torrent || torrent.destroyed || (!torrent.current && torrent.progress < 1)) return
    if (torrent.progress < 1 && torrent.current && this.settings.torrentPersist) {
      torrent.current = false
      torrent.staging = true
      this.dispatch('staging', torrent.infoHash)
      debug('Loaded torrent did not finish downloading, moving to staging: ' + torrent.torrentFile)
      return
    }

    const seedingLimit = 1 // this.settings.seedingLimit
    if ((((this.torrents.filter(_torrent => _torrent.seeding && !_torrent.destroyed)?.length || 0) + 1) > (seedingLimit || 1)) || (seedingLimit || 1) === 1) {
      const removed = this.torrents.filter(_torrent => _torrent.seeding && !_torrent.destroyed).sort((a, b) => (b.ratio || 0) - (a.ratio || 0))[0]
      if (!this.settings.torrentPersist) await removeTorrent(this.torrentCache, removed.infoHash)
      else {
        const stats = { infoHash: removed.infoHash, name: removed.name, size: removed.length, incomplete: (removed.progress < 1) }
        this.completed = Array.from(new Set([...this.completed || [], stats]))
        this.dispatch('completed', stats)
      }
      await this.remove(removed, { destroyStore: !this.settings.torrentPersist && (!torrent.staging || torrent.current) })
      debug('Completed torrent: ' + removed?.torrentFile)
    }

    torrent.current = false
    torrent.staging = false
    if (!torrent.seeding) {
      torrent.seeding = true
      if (type !== 'seed') this.dispatch('seeding', torrent.infoHash)
      debug('Seeding torrent: ' + torrent.torrentFile)
    }
  }

  promoteTorrent(torrent, skipVerify, type) {
    if (this.destroyed || torrent.destroyed) return
    if (!skipVerify) {
      structureHash(path.join(torrent.path, torrent.name)).then(structureHash => {
        saveTorrent(this.torrentCache, torrent.infoHash, {
          infoHash: torrent.infoHash,
          name: torrent.name,
          size: torrent.length,
          path: torrent.path,
          structureHash: torrent.progress === 1 ? structureHash : '',
          cachedAt: Date.now(),
          updatedAt: Date.now(),
          torrentFile: toBase64(torrent.torrentFile)
        })
      })
    } else {
      getTorrent(this.torrentCache, null, torrent.infoHash).then(cachedTorrent => {
        if (cachedTorrent?.length) {
          const updatedTorrent = structuredClone(cachedTorrent)
          updatedTorrent.path = torrent.path
          if (!deepEqual(updatedTorrent, cachedTorrent)) {
            updatedTorrent.updatedAt = Date.now()
            saveTorrent(this.torrentCache, torrent.infoHash, updatedTorrent)
          }
        }
      })
    }

    if (torrent.current) {
      this.torrents.filter(_torrent => (_torrent.staging || _torrent.seeding) && Array.isArray(_torrent.files)).forEach(_torrent => {
        _torrent.files.forEach(file => {
          if (!file._destroyed && !file.selected) file.select()
        })
      })
    }
    if (!torrent.current || type === 'current') this.seedTorrent(torrent, type)
  }

  async handleMessage ({ data }) {
    if (this.destroyed) return
    switch (data.type) {
      case 'load': {
        this.loadLastTorrent(data.data)
        break
      } case 'destroy': {
        this.destroy()
        break
      } case 'scrape': {
        this._scrape(data.data)
        break
      } case 'rescan': {
        this.dispatch('info', 'Rescanning the torrent cache, this will take a moment...')
        const excludeHashes = new Set([...this.torrents.map(torrent => torrent.infoHash), ...(this.completed || []).map(torrent => torrent.infoHash)].filter(Boolean))
        const torrents = (await getTorrents(this.torrentCache)).filter(torrent => !excludeHashes.has(torrent.infoHash))
        let missingCount = 0
        let removedCount = 0
        for (const torrent of torrents) {
          if (!torrent.structureHash?.length) {
            missingCount++
            this.stageTorrent(fromBase64(torrent.torrentFile), null, false, 'rescan')
          }
          else if ((await isVerified(path.join(torrent.path, torrent.name), torrent.structureHash))) {
            missingCount++
            const stats = { infoHash: torrent.infoHash, name: torrent.name, size: torrent.size, incomplete: !torrent.structureHash?.length }
            this.completed = Array.from(new Set([...this.completed || [], stats]))
            this.dispatch('completed', stats)
          } else {
            removedCount++
            removeTorrent(this.torrentCache, torrent.infoHash)
          }
        }
        this.dispatch('info', `Rescan complete: ${missingCount} missing torrents found, ${removedCount} removed from cache.`)
        break
      } case 'settings': {
        this.settings = { ...data.data, torrentPathNew: this.settings.torrentPathNew }
        break
      } case 'current': {
        if (data.data) {
          const torrent = await this.get(data.data.current.infoHash)
          if (!torrent || torrent.destroyed) return
          const found = torrent.files.find(file => file.path === data.data.current.path)
          if (!found || found._destroyed) return
          if (this.playerProcess) {
            this.playerProcess.kill()
            this.playerProcess = null
          }
          if (this.currentFile) {
            this.currentFile.removeAllListeners('stream')
            if (this.settings.torrentStreamedDownload && !this.currentFile._destroyed && torrent.progress < 1 && this.currentFile.selected) this.currentFile.deselect()
          }
          if (this.settings.torrentStreamedDownload && torrent.progress < 1) {
            this.torrents.filter(_torrent => (_torrent.staging || _torrent.seeding) && Array.isArray(_torrent.files)).forEach(_torrent => {
              _torrent.files.forEach(file => {
                if (!file._destroyed && file.selected) file.deselect()
              })
            })
          }
          this.parser?.destroy()
          if (!found.selected) found.select()
          if (found.length > await this.storageQuota(torrent.path)) this.dispatchError('File Too Big! This File Exceeds The Selected Drive\'s Available Space. Change Download Location In Torrent Settings To A Drive With More Space And Restart The App!')
          this.currentFile = found
          const currentTorrent = this.torrents.find(_torrent => _torrent.current)
          if (currentTorrent) currentTorrent.current = false
          torrent.current = true
          if (data.data.external) {
            if (this.player) {
              this.playerProcess = spawn(this.player, ['' + new URL('http://localhost:' + this.server.address().port + found.streamURL)])
              this.playerProcess.stdout.on('data', () => {})
              const startTime = Date.now()
              this.playerProcess.once('close', () => {
                if (this.destroyed) return
                this.playerProcess = null
                const seconds = (Date.now() - startTime) / 1000
                this.dispatch('externalWatched', seconds)
              })
              return
            }
            if (SUPPORTS.isAndroid) {
              this.dispatch('open', `intent://localhost:${this.server.address().port}${found.streamURL}#Intent;type=video/any;scheme=http;end;`)
              return
            }
          }
          this.parser = new Parser(this, found)
          this.findSubtitleFiles(found)
          this.findFontFiles(found)
        }
        break
      } case 'torrent': {
        const hash = data.data && data.data.hash
        const torrentID = data.data && data.data.id
        const cache = await getTorrent(this.torrentCache, torrentID, hash)
        const skipVerify = cache?.torrentFile && (await isVerified(path.join(cache.path, cache.name), cache.structureHash))
        if (!skipVerify && data.data.magnet) this.dispatch('info', 'A Magnet Link has been detected and is being processed. Files will be loaded shortly...')
        this.addTorrent(cache?.torrentFile ? fromBase64(cache?.torrentFile) : torrentID, torrentID, skipVerify, hash)
        break
      } case 'stage': {
        const hash = data.data && data.data.hash
        const torrentID = data.data && data.data.id
        const cache = await getTorrent(this.torrentCache, torrentID, hash)
        this.stageTorrent(cache?.torrentFile ? fromBase64(cache?.torrentFile) : torrentID, torrentID, cache?.torrentFile && (await isVerified(path.join(cache.path, cache.name), cache.structureHash)))
        break
      } case 'complete': {
        const cache = await getTorrent(this.torrentCache, null, data.data)
        if (cache?.torrentFile) {
          if (!this.settings.torrentPersist) await removeTorrent(this.torrentCache, cache?.infoHash)
          else {
            const stats = { infoHash: cache.infoHash, name: cache.name, size: cache.size, incomplete: !cache.structureHash?.length }
            this.completed = Array.from(new Set([...this.completed || [], stats]))
            this.dispatch('completed', stats)
          }
          const removed = this.torrents.find(torrent => torrent.infoHash === cache.infoHash)
          if (removed) {
            if (!this.settings.torrentPersist) await removeTorrent(this.torrentCache, removed.infoHash)
            await this.remove(removed, { destroyStore: !this.settings.torrentPersist })
          }
          debug('Completed torrent: ' + removed?.torrentFile)
        }
        break
      } case 'stage_all': {
        for (const hash of data.data) {
          const cache = await getTorrent(this.torrentCache, null, hash)
          if (cache?.torrentFile) this.stageTorrent(fromBase64(cache?.torrentFile), hash, await isVerified(path.join(cache.path, cache.name), cache.structureHash), 'stage')
          else this.dispatch('untrack', hash)
        }
        debug('Loaded staging torrents:', data.data)
        break
      } case 'seed_all': {
        for (const hash of data.data) {
          const cache = await getTorrent(this.torrentCache, null, hash)
          if (cache?.torrentFile) this.stageTorrent(fromBase64(cache?.torrentFile), hash, await isVerified(path.join(cache.path, cache.name), cache.structureHash), 'seed')
          else this.dispatch('untrack', hash)
        }
        debug('Loaded seeding torrents:', data.data)
        break
      } case 'complete_all': {
        const stats = await Promise.all(data.data.map(async (hash) => {
          const cache = await getTorrent(this.torrentCache, null, hash)
          if (!cache?.torrentFile || (cache.structureHash?.length && !(await isVerified(path.join(cache.path, cache.name), cache.structureHash)))) {
            this.dispatch('untrack', hash)
            return null
          }
          return { infoHash: cache.infoHash, name: cache.name, size: cache.size, incomplete: !cache.structureHash?.length }
        }))
        this.completed = Array.from(new Set([...this.completed || [], ...stats.filter(Boolean) || []]))
        this.dispatch('completedStats', this.completed.reverse())
        debug('Loaded completed torrents:', data.data)
        break
      } case 'unload': {
        if (!data.data && this.torrents.find(torrent => torrent.current)) {
          await this.remove(this.torrents.find(torrent => torrent.current), { destroyStore: false })
          this.currentFile = null
        } else if (data.data) {
          const cache = await getTorrent(this.torrentCache, data.data)
          if (cache?.infoHash) {
            const stats = { infoHash: cache.infoHash, name: cache.name, size: cache.size, incomplete: !cache.structureHash?.length }
            this.completed = Array.from(new Set([...this.completed || [], stats]))
            this.dispatch('completed', stats)
          }
        }
        break
      } case 'untrack': {
        const untrack = this.torrents.find(torrent => torrent.infoHash === data.data)
        if (untrack) {
          if (!this.settings.torrentPersist) await removeTorrent(this.torrentCache, untrack.infoHash)
          await this.remove(untrack, { destroyStore: !this.settings.torrentPersist || (untrack.progress < 1) })
        }
        this.dispatch('untrack', data.data)
        break
      } case 'debug': {
        Debug.disable()
        if (data.data) Debug.enable(data.data)
      }
    }
  }

  bindTracker(torrent) {
    if (!torrent?.infoHash || torrent.tracker) return
    if (!(torrent.announce || []).length) return

    const client = new Client({
      infoHash: torrent.infoHash,
      announce: torrent.announce,
      peerId: torrent.client?.peerId,
      port: this.torrentPort
    })

    client.on('update', (data) => {
      // Only update if it's a new/better tracker report, typically it will lean toward favoring a specific url and sticking with it.
      if (!torrent.trackerUrl || (torrent.trackerUrl === data.announce) || (torrent.seeders <= data.complete)) {
        torrent.seeders = data.complete
        torrent.leechers = data.incomplete
        torrent.trackerUrl = data.announce
        debug(`Updated seeders and leechers:`, { name: torrent.name, infoHash: torrent.infoHash, seeders: torrent.seeders, leechers: torrent.leechers, trackerUrl: torrent.trackerUrl })
      }
    })

    torrent.tracker = client
    const _destroy = torrent.destroy.bind(torrent)
    torrent.destroy = (opts, cb) => {
      client.destroy()
      return _destroy(opts, cb)
    }
    torrent.once('done', () => client.complete())
    debug(`Successfully bound tracker:`, { name: torrent.name, infoHash: torrent.infoHash })
  }

  async _scrape ({ id, infoHashes }, tracker = null) {
    debug(`Scraping ${infoHashes.length} hashes, id: ${id}, process: ${!!tracker}`)
    const MAX_ANNOUNCE_LENGTH = 1300 // it's likely 2048, but let's undercut it
    const RATE_LIMIT = 200 // ms
    const ANNOUNCE_LENGTH = (tracker || this.tracker).scrapeUrl.length
    let batch = []
    let currentLength = ANNOUNCE_LENGTH // fuzz the size a little so we don't always request the same amt of hashes
    const results = []
    const scrape = async () => {
      if (results.length) await sleep(RATE_LIMIT)
      const result = await new Promise(resolve => {
        (tracker || this.tracker)._request((tracker || this.tracker).scrapeUrl, { info_hash: batch }, (err, data) => {
          if (err) {
            const error = errorToString(err)
            debug('Failed to scrape: ' + error)
            if (!tracker) this.dispatch('warn', `Failed to update seeder counts: ${error}`)
            return resolve([])
          }
          const { files } = data
          const result = []
          debug(`Scraped ${Object.keys(files || {}).length} hashes, id: ${id}, process: ${!!tracker}`)
          for (const [key, data] of Object.entries(files || {})) result.push({ hash: key.length !== 40 ? arr2hex(text2arr(key)) : key, ...data })
          resolve(result)
        })
      })
      results.push(...result)
      batch = []
      currentLength = ANNOUNCE_LENGTH
    }

    for (const infoHash of infoHashes.sort(() => 0.5 - Math.random()).map(infoHash => hex2bin(infoHash))) {
      const qsLength = stringifyQuery({ info_hash: infoHash }).length + 1 // qs length + 1 for the & or ? separator
      if (currentLength + qsLength > MAX_ANNOUNCE_LENGTH) await scrape()
      batch.push(infoHash)
      currentLength += qsLength
    }
    if (batch.length) await scrape()
    debug(`Scraped ${results.length} hashes, id: ${id}, process: ${!!tracker}`)

    if (!tracker) this.dispatch('scrape', { id, result: results })
    return { id, result: results }
  }

  async dispatch (type, data, transfer) {
    await this._ready
    this.message?.({ type, data }, transfer)
  }

  dispatchError (e) {
    const error = errorToString(e)
    for (const exclude of ['WebSocket', 'User-Initiated Abort, reason=', 'Connection failed.']) {
      if (error.startsWith(exclude)) return
    }
    console.error('Error: ' + error, e)
    this.dispatch('error', error)
  }

  destroy () {
    debug('Destroying TorrentClient')
    if (this.destroyed) {
      debug('Ooops! TorrentClient is already destroyed!')
      this.ipc?.send('destroyed')
      this.ipc?.emit('destroyed')
      return
    }
    this.tracker?.destroy(() => null)
    this.parser?.destroy()
    this.server?.close()
    super.destroy(() => {
      this.ipc?.send('destroyed')
      this.ipc?.emit('destroyed')
    })
  }
}