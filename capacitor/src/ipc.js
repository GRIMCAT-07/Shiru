import { App } from '@capacitor/app'
import { NodeJS } from 'capacitor-nodejs'
import { ForegroundService, Importance, ServiceType } from '@capawesome-team/capacitor-android-foreground-service'
import { cache, caches } from '@/modules/cache.js'
import Updater from './updater.js'
import EventEmitter from 'events'

const ready = NodeJS.whenReady()

const main = new EventEmitter()
const STREAMING_FG_ID = 1001

export default main

ForegroundService.createNotificationChannel({
  id: 'external-playback',
  name: 'External Playback',
  description: 'Keeps Video Streaming To An External Player Active',
  importance: Importance.Min
})

main.on('portRequest', async () => {
  globalThis.port = {
    onmessage: cb => {
      NodeJS.addListener('ipc', ({ args }) => cb(args[0]))
    },
    postMessage: (data, b) => {
      NodeJS.send({ eventName: 'ipc', args: [{ data }] })
    }
  }
  await ready
  await cache.isReady
  NodeJS.send({ eventName: 'port-init', args: [] })
  let stethoscope = true
  NodeJS.addListener('webtorrent-heartbeat', () => {
    if (stethoscope) {
      stethoscope = false
      NodeJS.send({ eventName: 'main-heartbeat', args: [{ ...cache.getEntry(caches.GENERAL, 'settings'), userID: cache.cacheID }] })
      NodeJS.addListener('torrentRequest', () => {
        NodeJS.send({ eventName: 'torrentPort', args: [] })
        main.emit('port')
      })
    }
  })

  NodeJS.addListener('external-open', () => {
    ForegroundService.startForegroundService({
      id: STREAMING_FG_ID,
      title: 'External Playback',
      body: 'Delivering Content To Your External Player',
      smallIcon: 'ic_filled',
      notificationChannelId: 'external-playback',
      serviceType: ServiceType.MediaPlayback,
      silent: true
    })
  })
})
main.on('webtorrent-reload', () => NodeJS.send({eventName: 'webtorrent-reload', args: []}))

const [_platform, arch] = navigator.platform.split(' ')

globalThis.version = {
  platform: globalThis.cordova?.platformId,
  arch
}

App.addListener('appStateChange', (state) => {
  if (state.isActive) {
    ForegroundService.stopForegroundService()
    NodeJS.send({ eventName: 'external-close', args: [] })
  }
})

main.once('version', async () => {
  const { version } = await App.getInfo()
  main.emit('version', version)
})

const autoUpdater = new Updater(main, 'https://github.com/RockinChaos/Shiru/releases/latest/download/latest-android.yml', 'https://api.github.com/repos/RockinChaos/Shiru/releases/latest')
main.on('update', () => autoUpdater.checkForUpdates())
main.on('quit-and-install', () => {
  if (autoUpdater.updateAvailable) autoUpdater.install(true)
})

let accessPromptListener
main.on('request-file-access', () => { // Request "All Files" Access when switching away from the /tmp/webtorrent folder.
  if (window.NativeBridge?.hasAllFilesAccess()) return
  if (accessPromptListener) {
    accessPromptListener.remove()
    accessPromptListener = null
  }
  window.NativeBridge?.requestAllFilesAccess()
  accessPromptListener = App.addListener('appStateChange', (state) => {
    if (state.isActive) {
      accessPromptListener.remove()
      accessPromptListener = null
      if (!window.NativeBridge?.hasAllFilesAccess()) main.emit('no-file-access')
    }
  })
})