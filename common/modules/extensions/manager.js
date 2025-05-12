import { settings } from '@/modules/settings.js'
import { cache, caches } from '@/modules/cache.js'
import { getRandomInt } from '@/modules/util.js'
import { status, printError } from '@/modules/networking.js'
import { SUPPORTS } from '@/modules/support.js'
import { wrap } from 'comlink'
import Debug from 'debug'
const debug = Debug('ui:manager')

function createWorker(source) {
    return new Worker(new URL('@/modules/extensions/worker.js', import.meta.url), { type: 'module', name: (source.locale || (source.update + '/')) + source.id })
}

async function getManifest(url) {
    try {
        if (url.startsWith('http')) return url
        if (/^[A-Z]:/.test(url) || url.startsWith('file:')) {
            const manifest = (await (await fetch((url.startsWith('file:') ? url : `file:///${url.replace(/\\/g, '/')}`) + (!url.endsWith('.json') ? `${!url.endsWith('/') ? '/' : ''}index.json` : ''))).json())
            if (!manifest) return null
            for (const key of Object.keys(manifest || {})) {
                if (typeof manifest[key] === 'object' && manifest[key] !== null && !url.startsWith('file:')) {
                    const locale = `file:///${url.replace(/\\/g, '/').replace(/[^/]+\.json$/, '')}`
                    manifest[key].locale = locale + (!locale.endsWith('/') ? '/' : '')
                }
            }
            return manifest
        }
        const { pathname, protocol } = new URL(url)
        if (protocol !== 'gh:' && protocol !== 'npm:') return null
        const basePath = `https://esm.sh${protocol === 'gh:' ? '/gh' : ''}/${pathname}`
        return (await fetch(url.endsWith('.json') ? basePath : `${basePath}/index.json`)).json()
    } catch(error) {
        await printError('Failed to fetch Source', `Unable to load manifest for: ${url}`, error)
        return null
    }
}

async function getExtension(name, url) {
    try {
        if (url.startsWith('http')) return url
        if (url.startsWith('file:')) return `${url}.js`
        const parsedUrl = new URL(url)
        const ghProtocol = parsedUrl.protocol === 'gh:'
        if (ghProtocol || parsedUrl.protocol === 'npm:') {
            const pathParts = parsedUrl.pathname.split('/')
            try {
                const res = await fetch(`${ghProtocol ? `https://esm.sh/gh/${pathParts[0]}/${pathParts[1]}` : `https://esm.sh/${pathParts[0]}`}/es2022/${pathParts.slice(ghProtocol ? 2 : 1).join('/')}.mjs`)
                if (!res.ok) throw new Error(`Failed to load extension code for url ${url} ${res.status} ${res.statusText}`)
                return await res.text()
            } catch (err) {
                await printError(`Failed to load extension ${name}`, err.message, err)
                return null
            }
        }
        return null
    } catch(error) {
        await printError('Failed to fetch Extension', `Unable to load extension for: ${name} ${url}`, error)
        return null
    }
}

class ExtensionManager {
    activeWorkers = {}
    inactiveWorkers = {}
    whenReady = Promise.resolve()
    defaultSource = SUPPORTS.extensions && atob('Z2g6Um9ja2luQ2hhb3MvU2hpcnUtRXh0ZW5zaW9ucy9hbmlzZWFyY2g=')

    constructor() {
        let sources
        debug('Loading extensions from sources...')
        settings.subscribe(value => {
            if (sources !== value.sourcesNew) {
                if (Object.values(sources || {})?.length && !Object.values(value.sourcesNew || {})?.length) return
                if (!Object.values(value.sourcesNew || {})?.length && this.defaultSource) this.whenReady = this.addSource(this.defaultSource)
                else if (value.sourcesNew) {
                    sources = value.sourcesNew
                    this.whenReady = this.updateExtensions(value.sourcesNew).then((update) => this.loadExtensions(value.sourcesNew, update))
                    debug('Found new sources and updated...', JSON.stringify(value.sourcesNew))
                }
            }
        })

        window.addEventListener('online', async () => {
            for (const [key, worker] of Object.entries(extensionManager.inactiveWorkers)) {
                if (!this.activeWorkers[key]) {
                    try {
                        if (!(await worker.validate())) throw new Error(`Source #validate() failed`)
                        this.activeWorkers[key] = worker
                        delete this.inactiveWorkers[key]
                    } catch (error) {
                        if (!this.inactiveWorkers[key]) worker.terminate()
                        await printError(`Failed to load extension ${key}`, error.message, error)
                    }
                }
            }
        })
    }

    reloadExtensions() {
        Object.values(this.activeWorkers).forEach(worker => worker.terminate())
        Object.values(this.inactiveWorkers).forEach(worker => worker.terminate())
        this.activeWorkers = {}
        this.whenReady = this.loadExtensions(settings.value.sourcesNew)
    }

    async removeSource(extensionId) {
        settings.update((value) => {
            const sourcesNew = { ...value.sourcesNew }
            for (const [_key, source] of Object.entries(sourcesNew)) {
                if (source.update === extensionId) {
                    const key = (source.locale || (source.update + '/')) + source.id
                    if (this.activeWorkers[key]) {
                        this.activeWorkers[key].terminate()
                        delete this.activeWorkers[key]
                    } else if (this.inactiveWorkers[key]) {
                        this.inactiveWorkers[key].terminate()
                        delete this.inactiveWorkers[key]
                    }
                    delete sourcesNew[_key]
                }
            }
            return { ...value, sourcesNew }
        })
    }

    pending = new Map()
    async addSource(url) {
        if (this.pending.has(url)) return this.pending.get(url)
        const promise = (async () => {
            const config = await getManifest(url)
            if (!config) {
                await printError('Failed to load source', `${url}: ${status.value !== 'offline' ? 'the source is not valid.' : 'no network connection!'}`, { message: `Failed to load source: ${url} ${status.value !== 'offline' ? 'the source is not valid.' : 'no network connection!'} ${JSON.stringify(extension)}`})
                this.pending.delete(url)
                return `Failed to load extension(s) from the provided source '${url}': ${status.value !== 'offline' ? 'the source is not valid.' : 'no network connection!'}`
            }
            for (const extension of config) {
                if (!this.validateConfig(extension)) {
                    await printError('Invalid extension format', `Invalid extension config: ${url}`, { message: `Invalid extension config: ${url} ${JSON.stringify(extension)}`})
                    this.pending.delete(url)
                    return `Failed to load extension(s) from '${url}': invalid extension format.`
                }
            }
            settings.update((value) => {
                const sourcesNew = { ...value.sourcesNew }
                const extensionsNew = { ...value.extensionsNew }
                config.forEach(extension => {
                    const key = (extension.locale || (extension.update + '/')) + extension.id
                    sourcesNew[key] = extension
                    if (!extensionsNew[key]) extensionsNew[key] = { enabled: true }
                })
                return { ...value, sourcesNew, extensionsNew }
            })
            this.pending.delete(url)
        })()
        this.pending.set(url, promise)
        return promise
    }

    async loadExtensions(extensions, update) {
        const extensionIds = Object.keys(extensions || {})
        if (!extensionIds?.length) return false
        const modules = !update ? Object.fromEntries(await Promise.all(extensionIds.map(async (id) => {
            const cachedModule = await cache.cachedEntry(caches.EXTENSIONS, (extensions[id]?.locale || (extensions[id]?.update + '/')) + extensions[id]?.id, true)
            return cachedModule ? [id, cachedModule] : null
        })).then(results => results.flatMap(result => result ? [result] : []))) : {}
        for (const key of extensionIds) {
            if (!modules[key]) {
                const newCode = await getExtension(extensions[key]?.name || extensions[key]?.id, (extensions[key]?.locale || (extensions[key]?.update + '/')) + extensions[key]?.main)
                modules[key] = (newCode && !extensions[key].locale ? await cache.cacheEntry(caches.EXTENSIONS, key, { mappings: true }, newCode, Date.now() + getRandomInt(7, 14) * 24 * 60 * 60 * 1000) : newCode) || cache.cachedEntry(caches.EXTENSIONS, key, true)
                if (!modules[key]) continue
            }

            if (!this.activeWorkers[key]) {
                try {
                    if (this.inactiveWorkers[key]) {
                        this.inactiveWorkers[key].terminate()
                        delete this.inactiveWorkers[key]
                    }
                    const worker = createWorker(extensions[key])
                    try {
                        /** @type {comlink.Remote<import('@/modules/extensions/worker.js').Worker>} */
                        const remoteWorker = await wrap(worker)
                        const initialize = await remoteWorker.initialize(key, modules[key])
                        if (!initialize.validated) {
                            this.inactiveWorkers[key] = remoteWorker
                            throw new Error(initialize.error)
                        }
                        this.activeWorkers[key] = remoteWorker
                    } catch (error) {
                        if (!this.inactiveWorkers[key]) worker.terminate()
                        throw new Error(error)
                    }
                } catch (error) {
                    await printError(`Failed to load extension ${key}`, error.message, error)
                }
            }
        }
        return true
    }

    async updateExtensions(currentExtensions) {
        const extensionIds = Object.keys(currentExtensions || {})
        if (!extensionIds?.length) return false

        const latestManifests = await Promise.all(Object.values(currentExtensions || {}).map(ext => ext?.locale || ext?.update).filter(url => url).map(url => getManifest(url)))
        const latestValid = Object.fromEntries(latestManifests.flat().filter(config => this.validateConfig(config) && extensionIds.includes((config.locale || (config.update + '/')) + config.id)).map(config => [((config.locale || (config.update + '/')) + config.id), config]))
        const toUpdate = extensionIds.filter(id => latestValid?.length && currentExtensions?.length && latestValid[id]?.version !== currentExtensions[id]?.version)
        if (toUpdate.length) {
            settings.update((value) => {
                const sourcesNew = { ...value.sourcesNew }
                toUpdate.forEach(id => {
                    try {
                        if (this.activeWorkers[id] && latestValid[id]) {
                            this.activeWorkers[id].terminate()
                            delete this.activeWorkers[id]
                        }
                    } catch (error) {
                        debug('Failed to terminate active workers during update, how did we even get here...?')
                    }
                    if (latestValid[id]) sourcesNew[id] = latestValid[id]
                })
                return { ...value, sourcesNew }
            })
            return true
        }
        return false
    }

    validateConfig(config) {
        return config && ['id', 'name', 'version', 'main', 'update'].every(prop => prop in config)
    }
}

export const extensionManager = new ExtensionManager()