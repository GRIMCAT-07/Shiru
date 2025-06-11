import { ipcMain, dialog } from 'electron'

export default class Dialog {
  constructor () {
    ipcMain.on('player', async ({ sender }) => {
      const { filePaths, canceled } = await dialog.showOpenDialog({
        title: 'Select video player executable',
        properties: ['openFile']
      })
      if (canceled) return
      if (filePaths.length) {
        const path = filePaths[0]
        sender.send('player', path)
      }
    })
    ipcMain.on('dialog', async ({ sender }) => {
      const { filePaths, canceled } = await dialog.showOpenDialog({
        title: 'Select torrent download location',
        properties: ['openDirectory']
      })
      if (canceled) return
      if (filePaths.length) {
        let path = filePaths[0]
        if (!(path.endsWith('\\') || path.endsWith('/'))) {
          if (path.indexOf('\\') !== -1) {
            path += '\\'
          } else if (path.indexOf('/') !== -1) {
            path += '/'
          }
        }
        sender.send('path', path)
      }
    })
  }
}
