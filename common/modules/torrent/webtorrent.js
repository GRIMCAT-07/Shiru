import WebTorrent from 'webtorrent'
import HTTPTracker from 'bittorrent-tracker/lib/client/http-tracker.js' //../../node_modules/bittorrent-tracker/lib/client/http-tracker.js
import { hex2bin, arr2hex, text2arr } from 'uint8-util'
import { toBase64, fromBase64, saveTorrent, getTorrent, getTorrents, removeTorrent, isVerified, structureHash, stringifyQuery, errorToString, ANNOUNCE, trackerUrl, trackerNSFWUrl, TMP } from './utility.js'
import { fontRx, getRandomInt, deepEqual, sleep, subRx, videoRx } from '../util.js'
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

  stagingTorrents = []
  seedingTorrents = []

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
    this.trackers = {}
    this.scrapeStats = {}
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
    this.currentTorrent = null

    setInterval(() => {
      if (this.destroyed) return
      this.dispatch('stats', {
        numPeers: this.currentTorrent?.numPeers || 0,
        uploadSpeed: this.currentTorrent?.uploadSpeed || 0,
        downloadSpeed: this.currentTorrent?.downloadSpeed || 0
      })
    }, 200)
    setInterval(() => {
      if (this.destroyed) return
      if (this.currentTorrent?.pieces) this.dispatch('progress', this.currentFile?.progress)
      this.dispatch('activity', {
        current: {
          infoHash: this.currentTorrent?.infoHash,
          name: this.currentTorrent?.name,
          size: this.currentTorrent?.length,
          progress: this.currentTorrent?.progress,
          numSeeders: this.scrapeStats?.[this.currentTorrent?.infoHash]?.seeders || 0,
          numLeechers: this.scrapeStats?.[this.currentTorrent?.infoHash]?.leechers || 0,
          numPeers: this.currentTorrent?.numPeers || 0,
          downloadSpeed: this.currentTorrent?.downloadSpeed || 0,
          uploadSpeed: this.currentTorrent?.uploadSpeed || 0,
          eta: this.currentTorrent?.timeRemaining,
          ratio: this.currentTorrent?.ratio
        },
        staging: this.stagingTorrents.map(torrent => ({
          infoHash: torrent.infoHash,
          name: torrent.name,
          size: torrent.length,
          progress: torrent.progress,
          numSeeders: this.scrapeStats?.[torrent.infoHash]?.seeders || 0,
          numLeechers: this.scrapeStats?.[torrent.infoHash]?.leechers || 0,
          numPeers: torrent.numPeers,
          downloadSpeed: torrent.downloadSpeed,
          uploadSpeed: torrent.uploadSpeed,
          eta: torrent.timeRemaining,
          ratio: torrent.ratio
        })),
        seeding: this.seedingTorrents.map(torrent => ({
          infoHash: torrent.infoHash,
          name: torrent.name,
          size: torrent.length,
          progress: torrent.progress,
          numSeeders: this.scrapeStats?.[torrent.infoHash]?.seeders || 0,
          numLeechers: this.scrapeStats?.[torrent.infoHash]?.leechers || 0,
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

    this.tracker = new HTTPTracker({}, trackerUrl)
    setInterval(async () => this.scrapeTorrents([ this.currentTorrent, ...(this.stagingTorrents || []), ...(this.seedingTorrents || []) ]), getRandomInt(300, 480) * 1000)

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
    debug('Got torrent metadata: ' + torrent?.name)
    const files = torrent.files.map(file => {
      return {
        infoHash: torrent.infoHash,
        torrent_name: torrent?.name,
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
    const files = this.currentTorrent?.files
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
    const files = this.currentTorrent?.files
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
    if (this.currentTorrent) await this.promoteTorrent(this.currentTorrent, this.currentTorrent.progress === 1, 'current')
    const existing = await this.get(data)
    if (existing) {
      this.releaseActive(existing)
      this.currentTorrent = existing
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
    torrent.once('verified', () => {
      if (this.destroyed) return
      if (!torrent.ready && !skipVerify) this.dispatch('info', 'Detected already downloaded files. Verifying file integrity. This might take a minute...')
    })
    torrent.once('ready', () => {
      this.scrapeTorrents([torrent])
      this.dispatch('loaded', { id: !recover ? og_data || data : torrent.torrentFile, infoHash: torrent.infoHash })
      this.torrentReady(torrent)
    })
    torrent.once('done', async () => this.promoteTorrent(torrent, skipVerify))
    this.currentTorrent = torrent
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
    this.stagingTorrents.push(torrent)
    this.scrapeTorrents([torrent])
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
      this.scrapeTorrents([torrent])
      if (!skipVerify || type !== 'stage') this.dispatch('staging', torrent.infoHash)
      this.promoteTorrent(torrent, skipVerify, type)
    })
    torrent.once('done', () => this.promoteTorrent(torrent, skipVerify, type))
    torrent.on('error', (err) => {
      this.dispatchError(`Pre-download error: ${err.message}`)
      this.releaseActive(torrent)
      if (!torrent.destroyed) torrent.destroy({ destroyStore: !this.settings.torrentPersist })
    })
  }

  async seedTorrent(torrent, type) {
    if (!torrent || torrent.destroyed) return
    if (torrent.progress < 1) {
      if (torrent === this.currentTorrent && !this.stagingTorrents.includes(torrent)) {
        this.stagingTorrents.push(torrent)
        this.dispatch('staging', torrent?.infoHash)
        debug('Loaded torrent did not finish downloading, moving to staging: ' + torrent?.torrentFile)
      }
      return
    }

    const index = this.stagingTorrents.indexOf(torrent)
    if (index !== -1) this.stagingTorrents.splice(index, 1)
    if (!this.seedingTorrents.includes(torrent)) {
      this.seedingTorrents.push(torrent)
      if (type !== 'seed') this.dispatch('seeding', torrent?.infoHash)
      debug('Seeding torrent: ' + torrent?.torrentFile)
    }

    if (((this.seedingTorrents.length + 1) > (this.settings.seedingLimit || 1)) || (this.settings.seedingLimit || 1) === 1) {
      const removed = this.seedingTorrents.filter(t => !t.destroyed).sort((a, b) => (b.ratio || 0) - (a.ratio || 0))[0]
      this.seedingTorrents = this.seedingTorrents.filter(t => t.infoHash !== removed.infoHash)
      if (!this.settings.torrentPersist) await removeTorrent(this.torrentCache, removed.infoHash)
      else {
        const stats = { infoHash: removed.infoHash, name: removed.name, size: removed.length, incomplete: false }
        this.completedTorrents = Array.from(new Set([...this.completedTorrents || [], stats]))
        this.dispatch('completed', stats)
      }
      await this.remove(removed, { destroyStore: !this.settings.torrentPersist })
      debug('Completed torrent: ' + removed?.torrentFile)
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
      if (this.stagingTorrents?.length) {
        for (const torrent of this.stagingTorrents) {
          if (!torrent.destroyed && !torrent.selected) torrent.select()
        }
      }
      if (this.seedingTorrents?.length) {
        for (const torrent of this.seedingTorrents) {
          if (!torrent.destroyed && !torrent.selected) torrent.select()
        }
      }
      if (torrent !== this.currentTorrent || type === 'current') this.seedTorrent(torrent, type)
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
        const excludeHashes = new Set([this.currentTorrent?.infoHash, ...this.stagingTorrents.map(t => t.infoHash), ...this.seedingTorrents.map(t => t.infoHash), ...(this.completedTorrents || []).map(t => t.infoHash)].filter(Boolean))
        const torrents = (await getTorrents(this.torrentCache)).filter(torrent => !excludeHashes.has(torrent.infoHash))
        let missingCount = 0
        let removedCount = 0
        for (const torrent of torrents) {
          if (!torrent.structureHash?.length) {
            missingCount++
            this.stageTorrent(fromBase64(torrent?.torrentFile), null, false, 'rescan')
          }
          else if ((await isVerified(path.join(torrent.path, torrent.name), torrent.structureHash))) {
            missingCount++
            const stats = { infoHash: torrent.infoHash, name: torrent.name, size: torrent.size, incomplete: !torrent.structureHash?.length }
            this.completedTorrents = Array.from(new Set([...this.completedTorrents || [], stats]))
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
            if (this.settings.torrentStreamedDownload && !this.currentFile._destroyed && torrent?.progress < 1 && this.currentFile.selected) this.currentFile.deselect()
          }
          if (this.settings.torrentStreamedDownload) {
            if (this.stagingTorrents?.length && torrent?.progress < 1) {
              for (const torrent of this.stagingTorrents) {
                for (const file of torrent.files) {
                  if (!file._destroyed && file.selected) file.deselect()
                }
              }
            }
            if (this.seedingTorrents?.length && torrent?.progress < 1) {
              for (const torrent of this.seedingTorrents) {
                if (!torrent.destroyed) {
                  for (const file of torrent.files) {
                    if (!file._destroyed && file.selected) file.deselect()
                  }
                }
              }
            }
          }
          this.parser?.destroy()
          if (!found.selected) found.select()
          if (found.length > await this.storageQuota(torrent.path)) this.dispatchError('File Too Big! This File Exceeds The Selected Drive\'s Available Space. Change Download Location In Torrent Settings To A Drive With More Space And Restart The App!')
          this.currentFile = found
          this.currentTorrent = torrent
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
            this.completedTorrents = Array.from(new Set([...this.completedTorrents || [], stats]))
            this.dispatch('completed', stats)
          }
          const removed = this.seedingTorrents.find(t => t.infoHash === cache.infoHash) || this.stagingTorrents.find(t => t.infoHash === cache.infoHash)
          if (removed) {
            if (!this.settings.torrentPersist) await removeTorrent(this.torrentCache, removed.infoHash)
            await this.remove(removed, { destroyStore: !this.settings.torrentPersist })
            this.releaseActive(removed)
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
        this.completedTorrents = Array.from(new Set([...this.completedTorrents || [], ...stats.filter(Boolean) || []]))
        this.dispatch('completedStats', this.completedTorrents)
        debug('Loaded completed torrents:', data.data)
        break
      } case 'unload': {
        if (!data.data && this.currentTorrent) {
          await this.remove(this.currentTorrent, { destroyStore: false })
          this.currentTorrent = null
          this.currentFile = null
        } else if (data.data) {
          const cache = await getTorrent(this.torrentCache, data.data)
          if (cache?.infoHash) {
            const stats = { infoHash: cache.infoHash, name: cache.name, size: cache.size, incomplete: !cache.structureHash?.length }
            this.completedTorrents = Array.from(new Set([...this.completedTorrents || [], stats]))
            this.dispatch('completed', stats)
          }
        }
        break
      } case 'untrack': {
        const untrack = this.seedingTorrents.find(t => t.infoHash === data.data) || this.stagingTorrents.find(t => t.infoHash === data.data)
        if (untrack) {
          if (!this.settings.torrentPersist) await removeTorrent(this.torrentCache, untrack.infoHash)
          await this.remove(untrack, { destroyStore: !this.settings.torrentPersist })
          this.releaseActive(untrack)
        }
        this.dispatch('untrack', data.data)
        break
      } case 'debug': {
        Debug.disable()
        if (data.data) Debug.enable(data.data)
      }
    }
  }

  async scrapeTorrents(torrents) {
    if (!this.destroyed && torrents?.length) {
      const announceMap = new Map()
      const announceCounts = new Map()
      for (const torrent of torrents) {
        if (!torrent?.infoHash || !torrent.announce) continue
        const announces = Array.isArray(torrent.announce) ? torrent.announce : torrent.announce.split(',').map(s => s.trim()).filter(Boolean)
        debug(`Scrapeable announces ${torrent.infoHash}`, announces)
        for (const url of announces) {
          if (!url.match(/\/announce(?:[^/]*)?$/)) continue
          if (!announceMap.has(url)) announceMap.set(url, new Set())
          announceMap.get(url).add(torrent.infoHash)
          announceCounts.set(url, (announceCounts.get(url) || 0) + 1)
        }
      }
      let bestAnnounce = announceMap.has(trackerNSFWUrl) ? trackerNSFWUrl : announceMap.has(trackerUrl) ? trackerUrl : [...announceCounts.entries()].reduce((best, [url, count]) => count > (announceCounts.get(best) || 0) ? url : best, null)
      if (!bestAnnounce) return
      const infoHashes = Array.from(announceMap.get(bestAnnounce) || [])
      if (infoHashes.length === 0) return

      let tracker = this.tracker
      if (bestAnnounce.toLowerCase().trim() !== trackerNSFWUrl.toLowerCase().trim() || bestAnnounce.toLowerCase().trim() !== trackerUrl.toLowerCase().trim()) {
        if (!this.trackers[bestAnnounce]) this.trackers[bestAnnounce] = new HTTPTracker({}, bestAnnounce)
        tracker = this.trackers[bestAnnounce]
      }

      const id = Math.trunc(Math.random() * Number.MAX_SAFE_INTEGER).toString()
      try {
        const data = await this._scrape({ id, infoHashes }, tracker)
        for (const [i, hash] of infoHashes.entries()) {
          const result = data?.result?.[i]
          if (result) this.scrapeStats[hash] = { seeders: result.complete || 0, leechers: result.incomplete || 0 }
        }
        debug(`Scraped ${infoHashes.length} hashes using ${bestAnnounce}`)
      } catch (err) {
        debug(`Failed to scrape torrents with ${bestAnnounce}`, err)
      }
    }
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

  releaseActive(torrent) {
    const stageIndex = this.stagingTorrents.indexOf(torrent)
    if (stageIndex !== -1) this.stagingTorrents.splice(stageIndex, 1)
    const seedIndex = this.seedingTorrents.indexOf(torrent)
    if (seedIndex !== -1) this.seedingTorrents.splice(seedIndex, 1)
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
    debug('Error: ' + error)
    this.dispatch('error', error)
  }

  destroy () {
    debug('Destroying TorrentClient')
    if (this.destroyed) {
      debug('Ooops! TorrentClient is already destroyed!')
      this.ipc?.send('destroyed')
      return
    }
    for (const tracker of Object.values(this.trackers)) tracker?.destroy(() => null)
    this.tracker?.destroy(() => null)
    this.parser?.destroy()
    this.server?.close()
    super.destroy(() => {
      this.ipc?.send('destroyed')
    })
  }
}