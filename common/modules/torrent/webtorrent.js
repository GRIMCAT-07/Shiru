import WebTorrent from 'webtorrent'
import Client from 'bittorrent-tracker'
import HTTPTracker from 'bittorrent-tracker/lib/client/http-tracker.js'
import { hex2bin, arr2hex, text2arr } from 'uint8-util'
import { toBase64, fromBase64, makeHash, getInfoHash, buffersEqual, hasIntegrity, getProgressAndSize, stringifyQuery, errorToString, ANNOUNCE, TMP } from './utility.js'
import { fontRx, sleep, subRx, videoRx } from '../util.js'
import { SUPPORTS } from '@/modules/support.js'
import { spawn } from 'node:child_process'
import Parser from '../parser.js'
import TorrentStore from './torrentstore.js'
import Debug from 'debug'
const debug = Debug('torrent:worker')

// HACK: this is https only, but electron doesn't run in https, weird.
if (!globalThis.FileSystemFileHandle) globalThis.FileSystemFileHandle = false

export default class TorrentClient extends WebTorrent {
  player = ''
  /** @type {ReturnType<spawn>} */
  playerProcess = null
  networking = 'online'

  /**
   * Creates a new TorrentClient instance.
   * @param {any} ipc - Inter-process communication interface.
   * @param {number} storageQuota - Maximum storage quota in bytes.
   * @param {string} serverMode - Server mode ('node', 'browser', etc.).
   * @param {object} settings - Torrent and network configuration settings.
   * @param {Promise<any>|null} controller - Optional server controller promise.
   */
  constructor(ipc, storageQuota, serverMode, settings, controller) {
    debug(`Initializing TorrentClient with settings: ${JSON.stringify(settings)}`)
    super({
      dht: settings.dht ? { concurrency: 4, maxAge: 1800000 } : false,
      utPex: settings.torrentPeX,
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
    this.torrentPath = this.settings.torrentPathNew || TMP || ''
    this.torrentCache = new TorrentStore(this.torrentPath)
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
        staging: this.torrents.filter(torrent => torrent.staging).map(torrent => ({
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
        seeding: this.torrents.filter(torrent => torrent.seeding).map(torrent => ({
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

  /**
   * Loads the most recently used torrent from cache and resumes it.
   * @param {string|Buffer} torrent - Magnet URI, torrent file, or torrent info.
   */
  async loadLastTorrent(torrent) {
    debug('Loading last torrent: ' + torrent)
    if (!torrent?.length) return
    const cache = await this.torrentCache.get(await getInfoHash(torrent))
    this.addTorrent(cache?.torrentFile ? fromBase64(cache?.torrentFile) : torrent, cache, true)
  }

  /**
   * Handles the current torrent metadata once it becomes available and notifies listeners with file and magnet info.
   * @param {import('webtorrent').Torrent} torrent - Active torrent instance.
   */
  async torrentReady(torrent) {
    if (this.destroyed) return
    debug('Got torrent metadata: ' + torrent.name)
    const files = torrent.files.map(file => {
      return {
        infoHash: torrent.infoHash,
        fileHash: makeHash(`${torrent.infoHash}:${file.name}:${file.size}`),
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
        if (torrent.numPeers === 0 && this.networking !== 'offline') this.dispatchError('No peers found for torrent, try using a different torrent.')
      }
    }, 30000).unref?.()
  }

  /**
   * Searches the current torrent for embedded font files and sends them to the renderer for use.
   * @param {object} targetFile - File currently being processed.
   */
  async findFontFiles(targetFile) {
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

  /**
   * Searches the current torrent for subtitle files matching the current video and sends them to the renderer.
   * @param {object} targetFile - File currently being processed.
   */
  async findSubtitleFiles(targetFile) {
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

  /**
   * Adds a torrent to the client for downloading or staging.
   * Restores from cache if available, verifies existing files, and begins progress tracking.
   *
   * @param {string|Buffer} id - Magnet URI, torrent file, or info hash.
   * @param {object} [cache] - Cached torrent metadata (if available).
   * @param {boolean} [current=false] - Whether to set as the active torrent for playback.
   * @param {boolean} [rescan=false] - True if adding during a cache rescan.
   */
  async addTorrent(id, cache, current = false, rescan = false) {
    if (this.destroyed || !id) return
    debug(`${current ? 'Adding' : 'Staging'} torrent: ` + id, cache)

    const currentTorrent = current && this.torrents.find(torrent => torrent.current)
    if (currentTorrent) await this.promoteTorrent(currentTorrent, true)
    const existing = await this.get(id)
    if (existing) {
      if (current) {
        existing.staging = false
        existing.seeding = false
        existing.current = current
        this.bumpTorrent(existing)
        this.dispatch('loaded', { id: existing.torrentFile, infoHash: existing.infoHash })
        if (existing.ready) this.torrentReady(existing)
      } else if (!rescan) this.dispatch('info', 'This torrent is already queued and downloading in the background...')
      return
    }

    const torrent = await this.add(id, {
      path: this.settings.torrentPathNew || undefined,
      announce: ANNOUNCE,
      bitfield: cache?.bitfield,
      deselect: current ? this.settings.torrentStreamedDownload : false
    })
    torrent.current = current
    torrent.staging = !current
    this.bumpTorrent(torrent)
    setTimeout(() => {
      if (!this.destroyed && !torrent.destroyed && torrent.current && !torrent.progress && !torrent.ready && torrent.numPeers === 0 && this.networking !== 'offline') this.dispatchError('No peers found for torrent, try using a different torrent.')
    }, 30000).unref?.()
    torrent.once('metadata', () => {
      if (!rescan && torrent.staging && torrent.progress < 1 && !cache?.infoHash) this.dispatch('info', 'Torrent queued for background download. Check the management page for progress...')
    })
    torrent.once('verified', async () => {
      if (this.destroyed || torrent.destroyed) return
      if (torrent.current && !torrent.ready && torrent.progress < 1 && cache?.infoHash) this.dispatch('info', 'Detected already downloaded files. Verifying file integrity. This might take a minute...')
      if (torrent.staging && this.settings.torrentStreamedDownload && this.currentFile && this.currentFile.progress !== 1) {
        torrent.deselect()
        for (const file of torrent.files) {
          if (!file._destroyed) file.deselect()
        }
      }
      if (!rescan && torrent.progress < 1 && (!this.settings.torrentStreamedDownload || torrent.staging) && (torrent.length > await this.storageQuota(torrent.path))) this.dispatchError('File Too Big! This File Exceeds The Selected Drive\'s Available Space. Change Download Location In Torrent Settings To A Drive With More Space And Restart The App!')
    })
    if (!torrent.ready) await new Promise(resolve => torrent.once('ready', resolve))

    let interval
    let dataStored = cache
    const torrentStore = this.torrentCache
    const cacheBitfield = async () => {
      if (dataStored?.bitfield && buffersEqual(dataStored.bitfield, torrent.bitfield?.buffer)) return
      dataStored = {
        infoHash: torrent.infoHash,
        name: torrent.name,
        cachedAt: dataStored?.cachedAt || Date.now(),
        updatedAt: Date.now(),
        bitfield: Buffer.from(torrent.bitfield?.buffer),
        torrentFile: dataStored?.torrentFile || toBase64(torrent.torrentFile)
      }
      await torrentStore.set(torrent.infoHash, dataStored)
    }
    const wrapTorrent  = async () => {
      clearInterval(interval)
      await cacheBitfield()
      await this.promoteTorrent(torrent)
    }
    if (torrent.progress === 1) await wrapTorrent()
    else {
      interval = setInterval(cacheBitfield, 8000)
      interval.unref?.()
      await cacheBitfield()
    }
    this.bindTracker(torrent)
    if (torrent.current) {
      this.dispatch('loaded', { id: torrent.torrentFile, infoHash: torrent.infoHash })
      this.torrentReady(torrent)
    } else if (torrent.staging && torrent.progress < 1) this.dispatch('staging', torrent.infoHash)

    torrent.on('done', wrapTorrent)
    torrent.on('destroy', wrapTorrent)
  }

  /**
   * Marks a torrent for seeding, respecting seeding limits.
   * Removes oldest seeding torrent if limit exceeded.
   *
   * @param {import('webtorrent').Torrent} torrent - Torrent to seed.
   */
  async seedTorrent(torrent) {
    if (!torrent || torrent.destroyed) return
    const seedingLimit = this.settings.seedingLimit || 1
    const seedingTorrents = this.torrents.filter(t => t.seeding && !t.destroyed)
    if (!torrent.seeding && !torrent.destroyed && seedingLimit > 1) {
      torrent.current = false
      torrent.staging = false
      torrent.seeding = true
      this.bumpTorrent(torrent)
      this.dispatch('seeding', torrent.infoHash)
      debug(`Seeding torrent: ${torrent.infoHash}`, torrent.torrentFile)
    }

    if ((seedingTorrents.length + 1) >= seedingLimit) {
      const completed = seedingTorrents.slice().sort((a, b) => (b.ratio || 0) - (a.ratio || 0))?.[0] || torrent
      completed.current = false
      completed.staging = false
      completed.seeding = false
      if (!this.settings.torrentPersist) await this.torrentCache.delete(completed.infoHash)
      else {
        const stats = { infoHash: completed.infoHash, name: completed.name, size: completed.length, progress: completed.progress, incomplete: completed.progress < 1 }
        this.completed = Array.from(new Map([...(this.completed || []), stats].map(item => [item.infoHash, item])).values())
        this.dispatch('completed', stats)
      }
      debug(`Completed torrent: ${completed.infoHash}`, completed.torrentFile)
      await this.remove(completed, { destroyStore: !this.settings.torrentPersist && !torrent.staging })
    }
  }

  /**
   * Promotes a torrent to an active or seeding state based on progress and persistence settings.
   * Also ensures staged/seeding torrents have files selected for download.
   *
   * @param {import('webtorrent').Torrent} torrent - Torrent to promote.
   * @param {boolean} [loaded=false] - True when switching from the current torrent to a new current torrent.
   */
  async promoteTorrent(torrent, loaded = false) {
    if (this.destroyed || torrent.destroyed) return
    if (torrent.current) {
      if (this.settings.torrentPersist) {
        if (torrent.progress < 1) {
          torrent.current = false
          torrent.staging = true
          this.bumpTorrent(torrent)
          this.dispatch('staging', torrent.infoHash)
          debug(`Loaded torrent did not finish downloading, moving to staging: ${torrent.infoHash}`, torrent.torrentFile)
        } else if (loaded) await this.seedTorrent(torrent)
      }
      this.torrents.filter(_torrent => (_torrent.staging || _torrent.seeding) && Array.isArray(_torrent.files)).forEach(_torrent => {
        _torrent.files.forEach(file => {
          if (!file._destroyed) file.select()
        })
      })
    } else await this.seedTorrent(torrent)
  }

  /**
   * Handles incoming IPC messages and dispatches torrent operations.
   * Supports loading, staging, seeding, rescanning, settings updates, playback control, and torrent completion events.
   *
   * @param {{data: any}} opts - IPC message event object.
   */
  async handleMessage({ data }) {
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
        const torrents = []
        for await (const torrent of this.torrentCache.entries()) {
          if (!excludeHashes.has(torrent.infoHash)) torrents.push(torrent)
        }
        let missingCount = 0
        let removedCount = 0
        for (const torrent of torrents) {
          if ((await getProgressAndSize(torrent))?.progress < 1) {
            missingCount++
            this.addTorrent(fromBase64(torrent.torrentFile), torrent, false, true)
          }
          else if (await this.torrentCache.exists(torrent.name, this.torrentPath)) {
            missingCount++
            const torrentStats = await getProgressAndSize(torrent)
            const verified = await hasIntegrity(fromBase64(torrent?.torrentFile), this.torrentPath)
            const stats = { infoHash: torrent.infoHash, name: torrent.name, size: torrentStats.size, progress: torrentStats.progress, incomplete: torrentStats.progress < 1 || !verified, missing_pieces: !verified }
            this.completed = Array.from(new Map([...(this.completed || []), stats].map(item => [item.infoHash, item])).values())
            this.dispatch('completed', stats)
          } else {
            removedCount++
            await this.torrentCache.delete(torrent.infoHash)
            await this.torrentCache.delete(torrent.name, this.torrentPath)
          }
        }
        this.dispatch('rescan_done')
        this.dispatch('info', `Rescan complete: ${missingCount} missing torrents found, ${removedCount} removed from cache.`)
        break
      } case 'settings': {
        this.settings = { ...data.data }
        this.throttleDownload(this.settings.downloadLimit)
        this.throttleUpload(this.settings.uploadLimit)
        this.player = this.settings.playerPath
        this.torrentPath = this.settings.torrentPathNew || TMP || ''
        this.torrentCache = new TorrentStore(this.torrentPath)
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
            if (this.settings.torrentStreamedDownload && !this.currentFile._destroyed && torrent.progress < 1) this.currentFile.deselect()
          }
          if (this.settings.torrentStreamedDownload && torrent.progress < 1) {
            this.torrents.filter(_torrent => (_torrent.staging || _torrent.seeding) && Array.isArray(_torrent.files)).forEach(_torrent => {
              _torrent.deselect()
              _torrent.files.forEach(file => {
                if (!file._destroyed) file.deselect()
              })
            })
          }
          this.parser?.destroy()
          found.select()
          if (this.settings.torrentStreamedDownload && (found.length > await this.storageQuota(torrent.path))) this.dispatchError('File Too Big! This File Exceeds The Selected Drive\'s Available Space. Change Download Location In Torrent Settings To A Drive With More Space And Restart The App!')
          this.currentFile = found
          const currentTorrent = this.torrents.find(_torrent => _torrent.current)
          if (currentTorrent) {
            currentTorrent.current = false
            this.bumpTorrent(currentTorrent)
          }
          torrent.current = true
          this.bumpTorrent(torrent)
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
        const cache = await this.torrentCache.get(hash || (await getInfoHash(torrentID)))
        if (!cache?.infoHash && data.data.magnet) this.dispatch('info', 'A Magnet Link has been detected and is being processed. Files will be loaded shortly...')
        this.addTorrent(cache?.torrentFile ? fromBase64(cache?.torrentFile) : torrentID, cache, true)
        break
      } case 'stage': {
        const hash = data.data && data.data.hash
        const torrentID = data.data && data.data.id
        const cache = await this.torrentCache.get(hash || (await getInfoHash(torrentID)))
        this.addTorrent(cache?.torrentFile ? fromBase64(cache?.torrentFile) : torrentID, cache)
        break
      } case 'complete': {
        const cache = await this.torrentCache.get(data.data)
        if (cache?.infoHash) {
          if (!this.settings.torrentPersist) await this.torrentCache.delete(data.data)
          else {
            const torrentStats = await getProgressAndSize(cache)
            const stats = { infoHash: cache.infoHash, name: cache.name, size: torrentStats.size, progress: torrentStats.progress, incomplete: torrentStats.progress < 1 }
            this.completed = Array.from(new Map([...(this.completed || []), stats].map(item => [item.infoHash, item])).values())
            this.dispatch('completed', stats)
          }
          const completed = this.torrents.find(torrent => torrent.infoHash === cache.infoHash)
          debug(`Completed torrent: ${completed?.infoHash}`, completed?.torrentFile)
          if (completed) {
            if (!this.settings.torrentPersist) await this.torrentCache.delete(completed.infoHash)
            await this.remove(completed, { destroyStore: !this.settings.torrentPersist })
          }
        }
        break
      } case 'stage_all': {
        for (const hash of data.data) {
          const cache = await this.torrentCache.get(hash)
          if (cache?.torrentFile) this.addTorrent(fromBase64(cache?.torrentFile), cache)
          else this.dispatch('untrack', hash)
        }
        debug('Loaded staging torrents:', data.data)
        break
      } case 'seed_all': {
        for (const hash of data.data) {
          const cache = await this.torrentCache.get(hash)
          if (cache?.torrentFile && await this.torrentCache.exists(cache.name, this.torrentPath)) this.addTorrent(fromBase64(cache?.torrentFile), cache)
          else this.dispatch('untrack', hash)
        }
        debug('Loaded seeding torrents:', data.data)
        break
      } case 'complete_all': {
        const stats = await Promise.all(data.data.map(async (hash) => {
          const cache = await this.torrentCache.get(hash)
          if (!cache?.infoHash || !(await this.torrentCache.exists(cache.name, this.torrentPath))) {
            this.dispatch('untrack', hash)
            return null
          }
          const torrentStats = await getProgressAndSize(cache)
          const verified = await hasIntegrity(fromBase64(cache?.torrentFile), this.torrentPath)
          return { infoHash: cache.infoHash, name: cache.name, size: torrentStats.size, progress: torrentStats.progress, incomplete: torrentStats.progress < 1 || !verified, missing: !verified }
        }))
        this.completed = Array.from(new Map([...(this.completed || []), ...(stats.filter(Boolean) || [])].map(item => [item.infoHash, item])).values())
        this.dispatch('completedStats', this.completed.reverse())
        debug('Loaded completed torrents:', data.data)
        break
      } case 'unload': {
        if (!data.data && this.torrents.find(torrent => torrent.current)) {
          await this.remove(this.torrents.find(torrent => torrent.current), { destroyStore: false })
          this.currentFile = null
        } else if (data.data) {
          const cache = await this.torrentCache.get(data.data?.hash && data.data?.torrent || (await getInfoHash(data.data?.torrent || data.data)))
          if (cache?.infoHash) {
            const torrentStats = await getProgressAndSize(cache)
            const stats = { infoHash: cache.infoHash, name: cache.name, size: torrentStats.size, progress: torrentStats.progress, incomplete: torrentStats.progress < 1 }
            this.completed = Array.from(new Map([...(this.completed || []), stats].map(item => [item.infoHash, item])).values())
            if (data.data?.hash) {
              const unload = this.torrents.find(torrent => torrent.infoHash === data.data.torrent)
              if (unload) await this.remove(unload, { destroyStore: !this.settings.torrentPersist })
            }
            this.dispatch('completed', stats)
          }
        }
        break
      } case 'untrack': { // User really doesn't want this, delete from cache and remove the file. (Probably should implement a prompt asking if the user wants to keep the associated files).
        const untrack = this.torrents.find(torrent => torrent.infoHash === data.data)
        if (untrack) {
          await this.torrentCache.delete(untrack.infoHash)
          await this.remove(untrack, { destroyStore: true })
        } else if (this.completed?.find(torrent => torrent.infoHash === data.data)) {
          await this.torrentCache.delete(data.data)
          await this.torrentCache.delete(this.completed.find(torrent => torrent.infoHash === data.data).name, this.torrentPath)
        }
        this.dispatch('untrack', data.data)
        break
      } case 'networking': {
        this.networking = data.data
        break
      } case 'alive': {
        this.dispatch('alive')
        break
      } case 'debug': {
        Debug.disable()
        if (data.data) Debug.enable(data.data)
      }
    }
  }

  /**
   * Binds an HTTP tracker client to the given torrent to update seeder/leecher counts.
   * Overrides the torrent's `destroy` method to ensure the tracker client is cleaned up.
   *
   * @param {import('webtorrent').Torrent} torrent - Torrent to bind the tracker to.
   */
  bindTracker(torrent) {
    if (!torrent?.infoHash || torrent.destroyed || torrent.tracker || !torrent.client?.peerId || !(torrent.announce || []).length) return

    const client = new Client({
      infoHash: torrent.infoHash,
      announce: torrent.announce,
      peerId: torrent.client.peerId,
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

  /**
   * Performs a tracker scrape request for one or more info hashes.
   * Used to retrieve current seeder/leecher counts from trackers.
   * TODO: Rework this, it works but is not very good and prone to hanging...
   *
   * @param {{id: string, infoHashes: string[]}} opts - Scrape request containing ID and info hashes.
   * @returns {Promise<{id: string, result: object[]}>} Scrape results keyed by info hash.
   */
  async _scrape({ id, infoHashes }) {
    debug(`Scraping ${infoHashes.length} hashes, id: ${id}`)
    const MAX_ANNOUNCE_LENGTH = 1300 // it's likely 2048, but let's undercut it
    const RATE_LIMIT = 200 // ms
    const ANNOUNCE_LENGTH = this.tracker.scrapeUrl.length
    let batch = []
    let currentLength = ANNOUNCE_LENGTH // fuzz the size a little so we don't always request the same amt of hashes
    const results = []
    const scrape = async () => {
      if (results.length) await sleep(RATE_LIMIT)
      const result = await new Promise(resolve => {
        this.tracker._request(this.tracker.scrapeUrl, { info_hash: batch }, (err, data) => {
          if (err) {
            const error = errorToString(err)
            debug('Failed to scrape: ' + error)
            this.dispatch('warn', `Failed to update seeder counts: ${error}`)
            return resolve([])
          }
          const { files } = data
          const result = []
          debug(`Scraped ${Object.keys(files || {}).length} hashes, id: ${id}`)
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
    debug(`Scraped ${results.length} hashes, id: ${id}`)

    this.dispatch('scrape', { id, result: results })
    return { id, result: results }
  }

  /**
   * Moves the specified torrent to the front of the torrent list.
   * Useful for prioritizing torrents in UI and processing order.
   *
   * @param {import('webtorrent').Torrent} torrent - Torrent to prioritize.
   */
  bumpTorrent(torrent) {
    const index = this.torrents.indexOf(torrent)
    if (index > -1) this.torrents.splice(index, 1)
    this.torrents.unshift(torrent)
  }

  /**
   * Dispatches an event to the IPC channel once the client is ready.
   *
   * @param {string} type - Event type name.
   * @param {any} data - Event payload data.
   * @param {Transferable[]} [transfer] - Optional transferable objects for structured cloning.
   */
  async dispatch(type, data, transfer) {
    await this._ready
    this.message?.({ type, data }, transfer)
  }

  /**
   * Converts and filters an error before dispatching it to listeners.
   * Ignores common/expected connection-related errors.
   *
   * @param {Error|string} e - Error object or message to dispatch.
   */
  dispatchError(e) {
    const error = errorToString(e)
    for (const exclude of ['WebSocket', 'User-Initiated Abort, reason=', 'Connection failed.']) {
      if (error.startsWith(exclude)) return
    }
    console.error('Error: ' + error, e)
    this.dispatch('error', error)
  }

  /**
   * Gracefully shuts down the TorrentClient, closing trackers, parser, server, and destroying all torrents.
   * Emits a `destroyed` event via IPC once complete.
   */
  destroy() {
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