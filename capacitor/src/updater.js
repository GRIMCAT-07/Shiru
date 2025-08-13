import { App } from '@capacitor/app'
import ApkUpdater from 'cordova-plugin-apkupdater'

const development = process.env.NODE_ENV?.trim() === 'development'
const versionCodes = { 'arm64-v8a': 1, 'armeabi-v7a': 2, 'x86': 3, 'universal': 4 }
const sanitizeVersion = (version) => ((version || '').match(/[\d.]+/g)?.join('') || '')
export default class Updater {
  hasUpdate = false
  downloading = false

  updateURL
  main
  build
  currentVersion
  versionCode
  releaseInfo
  constructor(main, updateURL) {
    this.main = main
    this.updateURL = updateURL
    this.getInfo()
  }

  async getInfo() {
    const appInfo = await App.getInfo()
    this.build = appInfo.build
    this.currentVersion = appInfo.version
    this.versionCode = await this.parseABI()
  }

  async parseABI() {
    if (this.build.length === 7) {
      const versionCode = parseInt(this.build.substring(0, 1))
      if (versionCode < 5) {
        for (const [arch, code] of Object.entries(versionCodes)) {
          if (code === versionCode) return arch
        }
      } else if (versionCode === 5) return 'arm64-v8a'
    }
    return 'universal'
  }

  async checkForUpdates() {
    try {
      this.releaseInfo = await (await fetch(this.updateURL)).json()
      //if (this.isOutdated(this.releaseInfo.tag_name, this.currentVersion)) {
        this.downloading = true
        //if (!development) {
          //this.main.emit('update-available', sanitizeVersion(this.releaseInfo.tag_name))
          this.main.emit('update-available', sanitizeVersion('v6.1.6'))
          this.downloadUpdate()
       // } else console.debug('Skip checkForUpdates because application is not packed and dev update config is not forced')
      //}
    } catch (error) {
      console.error('Error checking for update:', error)
    }
  }

  isOutdated(v1, v2) {
    const a = sanitizeVersion(v1).split('.').map(Number)
    const b = sanitizeVersion(v2).split('.').map(Number)
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const num1 = a[i] || 0
      const num2 = b[i] || 0
      if (num1 > num2) return true
      if (num1 < num2) return false
    }
    return false
  }

  async downloadUpdate() {
    try {
     // const regex = new RegExp(`${(this.releaseInfo.tag_name || '').match(/[\d.]+/g)?.join('') || ''}.*${this.versionCode}`, 'i')
     // const asset = this.releaseInfo.assets.find(a => regex.test(a.browser_download_url))
     // if (!asset) {
     //   console.error('Update file not found for version and architecture:', this.releaseInfo.tag_name, this.versionCode)
     //   return
    //  }
      // ApkUpdater.download(asset.browser_download_url, { }, () => {
      //   this.hasUpdate = true
      //   this.main.emit('update-downloaded', sanitizeVersion(this.releaseInfo.tag_name))
      // }, (error) => {
      //   //console.error('Error opening update URL222:', error)
      // })

      console.error("Getting update")
      await ApkUpdater.download(
        'https://github.com/RockinChaos/Shiru/releases/download/v6.1.6/android-Shiru-v6.1.6-arm64-v8a.apk',
        {
          onDownloadProgress: console.error
        },
        () => {
          console.error('Download complete, ready to apply')
          this.hasUpdate = true
          this.main.emit('update-downloaded', sanitizeVersion('v6.1.6'))
        },
        console.error
      )
    } catch (error) {
      console.error('Error opening update URL:', error)
    }
  }

  install (forceRunAfter = false) {
    if (this.hasUpdate && forceRunAfter) {
      ApkUpdater.install(console.error, console.error)
      this.hasUpdate = false
      return true
    }
    return false
  }

  //clearInterval(this.downloadedInterval)
  //autoUpdater.quitAndInstall(true, true)
}