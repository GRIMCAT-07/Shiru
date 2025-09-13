import { toast } from 'svelte-sonner'
import { writable } from 'simple-store-svelte'
import { settings } from '@/modules/settings.js'
import { codes, getRandomInt } from '@/modules/util.js'
import Debug from 'debug'
const debug = Debug('ui:networking')

export const status = writable(navigator.onLine ? 'online' : 'offline')
export async function printError(title, description, error) {
    if (await isOffline(error)) return
    debug(`Error: ${error.status || 429} - ${error.message || codes[error.status || 429]}`)
    if (settings.value.toasts.includes('All') || settings.value.toasts.includes('Errors')) {
        toast.error(title, {
            description: `${description}\n${error.status || 429} - ${error.message || codes[error.status || 429]}`,
            duration: 10000
        })
    }
}

const fetch = window.fetch
window.fetch = async (...args) => {
    try {
        const res = await fetch(...args)
        if (!res.ok) {
            window.dispatchEvent(new CustomEvent('fetch-error', { detail: { error: {
                response: res?.response,
                status: res?.status,
                message: res?.message
            }, url: args[0]?.url || args[0], config: args[1] } }))
        }
        return res
    } catch (error) {
        window.dispatchEvent(new CustomEvent('fetch-error', { detail: { error, url: args[0]?.url || args[0], config: args[1] } }))
        throw error
    }
}

async function ping(timeout = 2000) {
    if (!navigator.onLine) return false
    const controller = new AbortController()
    const signal = controller.signal
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
        const res = await fetch('https://cp.cloudflare.com/generate_204?cacheBust=' + Date.now(), {
            method: 'HEAD',
            mode: 'no-cors',
            cache: 'no-cache',
            headers: { 'Pragma': 'no-cache' },
            signal
        })
        return res?.ok
    } catch (err) {
        return false
    } finally {
        clearTimeout(timer)
    }
}

function isNetworkError(error) {
    if (!error || error.response || (error.status && error.status >= 400)) return false
    return (/request failed|failed to fetch|resolve host|network\s?error/i).test(error.message || '')
}

let monitor
let offlinePromise
window.addEventListener('fetch-error', (event) => isOffline(event?.detail?.error))
export async function isOffline(error) {
    if (!offlinePromise && !monitor) {
        offlinePromise = (async () => {
            if (status.value === 'offline') return true
            debug('Detected an error when executing #fetch(), checking for network outage...')
            if (!isNetworkError(error)) return false
            debug(`Verified suspicious error with navigator.onLine=${navigator.onLine}, verifying with ping...`)
            const result = await ping()
            if (!result) {
                debug('Verified network is offline, starting up periodic checks for connectivity...')
                status.value = 'offline'
                window.dispatchEvent(new CustomEvent('offline'))
                if (!monitor) {
                    monitor = (() => {
                        let stop = false
                        async function checkLoop() {
                            if (stop) return
                            const result = await ping(status.value === 'offline' ? 500 : 2000)
                            if (result && status.value === 'offline') {
                                status.value = 'online'
                                window.dispatchEvent(new CustomEvent('online'))
                                debug('Detected that the network connection has been restored!')
                                stop = true
                                monitor = null
                            } else if (!result) {
                                debug('Network is still offline...')
                            }
                            if (!stop) setTimeout(checkLoop, getRandomInt(3, 5) * 1000)
                        }
                        checkLoop()
                        return () => (stop = true)
                    })()
                }
                return true
            } else {
                if (status.value === 'offline') {
                    status.value = 'online'
                    window.dispatchEvent(new CustomEvent('online'))
                }
                debug('Ping succeeded, network is online.')
                return false
            }
        })()
        offlinePromise.finally(() => offlinePromise = null)
    }
    return (await offlinePromise) || (status.value === 'offline')
}