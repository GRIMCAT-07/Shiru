import { files, nowPlaying as media } from '@/views/Player/MediaHandler.svelte'
import { page } from '@/App.svelte'
import { settings } from '@/modules/settings.js'
import { cache, caches } from '@/modules/cache.js'
import { SUPPORTS } from '@/modules/support.js'
import { toast } from 'svelte-sonner'
import clipboard from '@/modules/clipboard.js'
import { deepEqual } from '@/modules/util.js'
import IPC from '@/modules/ipc.js'
import 'browser-event-target-emitter'
import Debug from 'debug'

const debug = Debug('ui:torrent')

const torrentRx = /(^magnet:){1}|(^[A-F\d]{8,40}$){1}|(.*\.torrent$){1}/i
let _settings
class TorrentWorker extends EventTarget {
  static excludedToastMessages = ['no buffer space']

  constructor () {
    super()
    this.ready = new Promise(resolve => {
      IPC.once('port', () => {
        this.port = window.port
        this.port.onmessage(this.handleMessage.bind(this))
        resolve()
      })
      _settings = { userID: cache.cacheID, dht: !settings.value.torrentDHT, maxConns: settings.value.maxConns, downloadLimit: (settings.value.torrentSpeed * 1048576) || 0, uploadLimit: (settings.value.torrentSpeed * 1048576) || 0, torrentPort: settings.value.torrentPort || 0, dhtPort: settings.value.dhtPort || 0, torrentPersist: settings.value.torrentPersist, torrentPeX: settings.value.torrentPeX, torrentStreamedDownload: settings.value.torrentStreamedDownload, torrentPathNew: settings.value.torrentPathNew, playerPath: settings.value.playerPath, seedingLimit: settings.value.seedingLimit }
      IPC.emit('portRequest', _settings)
    })
    clipboard.on('text', ({ detail }) => {
      for (const { text } of detail) {
        if (page?.value !== 'watchtogether' && torrentRx.exec(text)) {
          media.value = { torrent: true }
          add(text, null, null, true)
        }
      }
    })
    clipboard.on('files', async ({ detail }) => { // doesn't work on Capacitor....
      for (const file of detail) {
        if (file.name.endsWith('.torrent')) {
          media.value = { torrent: true }
          add(new Uint8Array(await file.arrayBuffer()))
        }
      }
    })
  }

  handleMessage ({ data }) {
    this.emit(data.type, data.data)
  }

  async send (type, data, transfer) {
    await this.ready
    debug(`Sending message ${type}`, JSON.stringify(data))
    this.port.postMessage({ type, data }, transfer)
  }
}

export const client = new TorrentWorker()

settings.subscribe(value => {
  let settingsVal = { userID: cache.cacheID, dht: !value.torrentDHT, maxConns: value.maxConns, downloadLimit: (value.torrentSpeed * 1048576) || 0, uploadLimit: (value.torrentSpeed * 1048576) || 0, torrentPort: value.torrentPort || 0, dhtPort: value.dhtPort || 0, torrentPersist: value.torrentPersist, torrentPeX: value.torrentPeX, torrentStreamedDownload: value.torrentStreamedDownload, torrentPathNew: value.torrentPathNew, playerPath: value.playerPath, seedingLimit: value.seedingLimit }
  if (deepEqual(_settings) !== deepEqual(settingsVal)) {
    _settings = settingsVal
    client.send('settings', _settings)
  }
})

if (!settings.value.disableStartupTorrent) {
  client.send('load', cache.getEntry(caches.GENERAL, 'loadedTorrent'))
  client.send('stage_all', cache.getEntry(caches.GENERAL, 'stagingTorrents').filter(Boolean))
  client.send('seed_all', cache.getEntry(caches.GENERAL, 'seedingTorrents').filter(Boolean))
} else {
  debug(`Unloading torrent(s) from previous session`)
  client.send('unload', cache.getEntry(caches.GENERAL, 'loadedTorrent'))
  cache.setEntry(caches.GENERAL, 'loadedTorrent', [])
  cache.setEntry(caches.GENERAL, 'completedTorrents', Array.from(new Set([...(cache.getEntry(caches.GENERAL, 'completedTorrents') || []), ...(cache.getEntry(caches.GENERAL, 'seedingTorrents') || []), ...(cache.getEntry(caches.GENERAL, 'stagingTorrents') || [])])))
  cache.setEntry(caches.GENERAL, 'stagingTorrents', [])
  cache.setEntry(caches.GENERAL, 'seedingTorrents', [])
}
client.send('complete_all', cache.getEntry(caches.GENERAL, 'completedTorrents').filter(Boolean))

client.on('files', ({ detail }) => files.set(detail))

client.on('loaded', ({ detail }) => {
  cache.setEntry(caches.GENERAL, 'loadedTorrent', detail?.id)
  deduplicateTorrents(detail?.infoHash, 'stagingTorrents', 'seedingTorrents', 'completedTorrents')
  client.emit('untrack', detail?.infoHash)
})

client.on('untrack',  ({ detail }) => {
  debug(`Untracking torrent: ${detail}`)
  for (const category of ['stagingTorrents', 'seedingTorrents', 'completedTorrents']) {
    const list = cache.getEntry(caches.GENERAL, category) || []
    if (list.includes(detail)) cache.setEntry(caches.GENERAL, category, list.filter(h => h !== detail))
  }
})

client.on('staging',  ({ detail }) => {
  debug(`Staging torrent: ${detail}`)
  const torrents = cache.getEntry(caches.GENERAL, 'stagingTorrents') || []
  if (!torrents.includes(detail)) {
    cache.setEntry(caches.GENERAL, 'stagingTorrents', Array.from(new Set([...torrents, detail])))
  }
  deduplicateTorrents(detail, 'seedingTorrents', 'completedTorrents')
})

client.on('seeding',  ({ detail }) => {
  debug(`Seeding torrent: ${detail}`)
  const torrents = cache.getEntry(caches.GENERAL, 'seedingTorrents') || []
  if (!torrents.includes(detail)) cache.setEntry(caches.GENERAL, 'seedingTorrents', Array.from(new Set([...torrents, detail])))
  deduplicateTorrents(detail, 'stagingTorrents', 'completedTorrents')
})

client.on('completed',  ({ detail }) => {
  debug(`Completed torrent: ${detail}`)
  const torrents = cache.getEntry(caches.GENERAL, 'completedTorrents') || []
  if (!torrents.includes(detail?.infoHash)) cache.setEntry(caches.GENERAL, 'completedTorrents', Array.from(new Set([...torrents, detail.infoHash])))
  deduplicateTorrents(detail?.infoHash, 'stagingTorrents', 'seedingTorrents')
})

client.on('error', ({ detail }) => {
  debug(`Error: ${detail.message || detail}`)
  if (settings.value.toasts.includes('All') || settings.value.toasts.includes('Errors')) {
    for (const exclude of TorrentWorker.excludedToastMessages) {
      if ((detail.message || detail)?.toLowerCase()?.includes(exclude)) return
    }
    toast.error('Torrent Error', {description: '' + (detail.message || detail)})
  }
})

client.on('warn', ({ detail }) => {
  debug(`Warn: ${detail.message || detail}`)
  if (settings.value.toasts.includes('All') || settings.value.toasts.includes('Warnings')) {
    for (const exclude of TorrentWorker.excludedToastMessages) {
      if ((detail.message || detail)?.toLowerCase()?.includes(exclude)) return
    }
    toast.warning('Torrent Warning', {description: '' + (detail.message || detail)})
  }
})

client.on('info', ({ detail }) => {
  debug(`Info: ${detail.message || detail}`)
  for (const exclude of TorrentWorker.excludedToastMessages) {
    if ((detail.message || detail)?.toLowerCase()?.includes(exclude)) return
  }
  toast('Torrent Info', { description: '' + (detail.message || detail) })
})

export async function add(torrentID, search, hash, magnet) {
  if (torrentID) {
    debug('Adding torrent', { torrentID, hash })
    files.set([])
    page.set('player')
    media.value = !hash ? { media: (search?.media || media.value?.media), episode: (search?.episode || media.value?.episode), ...(media.value?.torrent ? { torrent: true } : { feed: true }) } : { torrent: true }
    window.dispatchEvent(new Event('overlay-check'))
    if (SUPPORTS.isAndroid) document.querySelector('.content-wrapper').requestFullscreen() // this WILL not work with auto-select torrents due to permissions check.
    client.send('torrent', { id: torrentID, hash: (hash && torrentID) || false, magnet })
  }
}
export async function stage(torrentID, hash) {
  if (torrentID) {
    debug('Pre-Adding torrent', { torrentID, hash })
    client.send('stage', { id: torrentID, hash: (hash && torrentID) || false })
  }
}

export async function untrack(hash) {
  if (hash) {
    debug('Untracking torrent', { hash })
    client.send('untrack', hash)
  }
}

export async function complete(hash) {
  if (hash) {
    debug('Stopping Seeding torrent', hash)
    client.send('complete', hash)
  }
}
// external player for android
client.on('open', ({ detail }) => {
  debug(`Open: ${detail}`)
  IPC.emit('intent', detail)
})

IPC.on('intent-end', () => client.dispatch('externalWatched'))

window.addEventListener('torrent-unload', () => {
  files.value = []
  media.value = { ...media.value, display: true } // set display to true to allow the 'Last Watched' button to remain on the SideBar.
  client.send('unload', null) // this will not override the cached loadedTorrent, we rely on users to enable disableStartupTorrent if they don't want to load the previous torrent when the app starts.
})

function deduplicateTorrents(hash, ..._caches) {
  if (!hash) return
  for (const cacheName of _caches) {
    const list = cache.getEntry(caches.GENERAL, cacheName) || []
    const filtered = list.filter(h => h !== hash)
    if (filtered.length !== list.length) {
      debug(`Detected duplicate torrent in: ${cacheName}`)
      cache.setEntry(caches.GENERAL, cacheName, filtered)
    }
  }
}