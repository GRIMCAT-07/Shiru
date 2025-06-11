import { ipcRenderer } from 'electron'
import { statfs } from 'fs/promises'

async function storageQuota (directory) {
  const { bsize, bavail } = await statfs(directory)
  return bsize * bavail
}

let heartbeatId
function setHeartBeat() {
  heartbeatId = setInterval(() => ipcRenderer.send('webtorrent-heartbeat'), 500)
}

setHeartBeat()
ipcRenderer.on('main-heartbeat', async (event, settings) => {
  clearInterval(heartbeatId)
  const { default: TorrentClient } = await import('@/modules/torrent/webtorrent.js')
  globalThis.client = new TorrentClient(ipcRenderer, storageQuota, 'node', settings)
})
ipcRenderer.on('webtorrent-reload', () => {
  globalThis.client?.destroy()
  setHeartBeat()
})