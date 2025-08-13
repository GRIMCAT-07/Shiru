import { App } from '@capacitor/app'
import ApkUpdater from 'cordova-plugin-apkupdater'

const development = process.env.NODE_ENV?.trim() === 'development'
const versionCodes = { 'arm64-v8a': 1, 'armeabi-v7a': 2, 'x86': 3, 'universal': 4 }
const sanitizeVersion = (version) => ((version || '').match(/[\d.]+/g)?.join('') || '')
export default class Updater {
  hasUpdate = false
  updateAvailable = false
  availableInterval

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
    if (this.build?.length === 7) {
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
    if (!development) {
      try {
        this.releaseInfo = await (await fetch(this.updateURL)).json()
        if (this.isOutdated()) {
          if (!this.updateAvailable && !this.hasUpdate) {
            this.updateAvailable = true
            this.availableInterval = setInterval(() => {
              if (!this.hasUpdate) this.main.emit('update-available', sanitizeVersion(this.releaseInfo.tag_name))
            }, 1000)
            this.availableInterval.unref?.()
          }
        }
      } catch (error) {
        console.error('Error checking for update:', error)
      }
    } else console.debug('Skip checkForUpdates because application is not packed and dev update config is not forced')
  }

  isOutdated() {
    const a = sanitizeVersion(this.releaseInfo.tag_name).split('.').map(Number)
    const b = sanitizeVersion(this.currentVersion).split('.').map(Number)
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const numA = a[i] || 0
      const numB = b[i] || 0
      if (numA > numB) return true
      if (numA < numB) return false
    }
    return false
  }

  async install(forceRequestInstall = false) {
    if (!this.hasUpdate && forceRequestInstall) {
      try {
        clearInterval(this.availableInterval)
        this.updateAvailable = false
        const regex = new RegExp(`${sanitizeVersion(this.releaseInfo.tag_name)}.*${this.versionCode}`, 'i')
        const asset = this.releaseInfo.assets.find(a => regex.test(a.browser_download_url))
        if (!asset) {
          console.error('Update file not found for version and architecture:', this.releaseInfo.tag_name, this.versionCode)
          return
        }
        this.hasUpdate = true
        await ApkUpdater.download(asset.browser_download_url, { onDownloadProgress: console.debug }, () => ApkUpdater.install(console.error, console.error), (error) => console.error('Updater failed to download update', error))
        return true
      } catch (error) {
        console.error(error)
      }
    }
    return false
  }
}