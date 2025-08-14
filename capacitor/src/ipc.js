import { App } from '@capacitor/app'
import { NodeJS } from 'capacitor-nodejs'
import { BatteryOptimization } from '@capawesome-team/capacitor-android-battery-optimization'
import { cache, caches } from '@/modules/cache.js'
import Updater from './updater.js'
import EventEmitter from 'events'

const ready = NodeJS.whenReady()

const main = new EventEmitter()

export default main

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
      NodeJS.send({eventName: 'main-heartbeat', args: [{ ...cache.getEntry(caches.GENERAL, 'settings'), userID: cache.cacheID }]})
      NodeJS.addListener('torrentRequest', () => {
        NodeJS.send({eventName: 'torrentPort', args: []})
        main.emit('port')
      })
    }
  })
})
main.on('webtorrent-reload', () => NodeJS.send({eventName: 'webtorrent-reload', args: []}))

const [_platform, arch] = navigator.platform.split(' ')

globalThis.version = {
  platform: globalThis.cordova?.platformId,
  arch
}

App.addListener('appStateChange', async (state) => {
  if (state.isActive) NodeJS.send({eventName: 'external-close', args: []})
})

main.once('version', async () => {
  const { version } = await App.getInfo()
  main.emit('version', version)
})

const autoUpdater = new Updater(main, 'https://api.github.com/repos/RockinChaos/Shiru/releases/latest')
main.on('update', () => autoUpdater.checkForUpdates())
main.on('quit-and-install', () => {
  if (autoUpdater.updateAvailable) autoUpdater.install(true)
})

let batteryPromptListener
main.on('battery-opt-ignore', async () => {
  if (batteryPromptListener) {
    batteryPromptListener.remove()
    batteryPromptListener = null
  }
  await BatteryOptimization.requestIgnoreBatteryOptimization()
  batteryPromptListener = App.addListener('appStateChange', async (state) => {
    if (state.isActive) {
      batteryPromptListener.remove()
      batteryPromptListener = null
      if ((await BatteryOptimization.isBatteryOptimizationEnabled())?.enabled) main.emit('battery-opt-enabled')
    }
  })
})