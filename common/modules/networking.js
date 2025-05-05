import { writable } from 'simple-store-svelte'
import { getRandomInt } from '@/modules/util.js'
import Debug from 'debug'

const debug = Debug('ui:networking')
export const status = writable('online')

async function ping(timeout = 2000) {
    if (!navigator.onLine) return false
    const controller = new AbortController()
    const signal = controller.signal
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
        await fetch('https://cp.cloudflare.com/generate_204?cacheBust=' + Date.now(), {
            method: 'HEAD',
            mode: 'no-cors',
            cache: 'no-cache',
            headers: { 'Pragma': 'no-cache' },
            signal
        })
        return true
    } catch (err) {
        return false
    } finally {
        clearTimeout(timer)
    }
}

let monitor
let offlinePromise
export async function isOffline(error) {
    if (!offlinePromise) {
        offlinePromise = (async () => {
            if (status.value === 'offline') return true
            debug('Detected an error when executing #fetch(), checking for network outage...')
            if (!(!error?.response && /request failed|failed to fetch|network\s?error/i.test(error?.message))) return false
            debug(`Verified suspicious error with navigator.onLine=${navigator.onLine}, verifying with ping...`)
            const result = await ping()
            if (!result) {
                debug('Verified network is offline, starting up periodic checks for connectivity...')
                status.value = 'offline'
                if (!monitor) {
                    monitor = (() => {
                        let stop = false
                        async function checkLoop() {
                            if (stop) return
                            const result = await ping(status.value === 'offline' ? 500 : 2000)
                            if (result && status.value === 'offline') {
                                status.value = 'online'
                                debug('Detected that the network connection has been restored!')
                                stop = true
                                monitor = null
                            } else if (!result) {
                                debug('Network is still offline...')
                            }
                            if (!stop) setTimeout(checkLoop, getRandomInt(1, 3) * 1000)
                        }
                        checkLoop()
                        return () => (stop = true)
                    })()
                }
                return true
            } else {
                if (status.value === 'offline') status.value = 'online'
                debug('Ping succeeded, network is online.')
                return false
            }
        })()
        offlinePromise.finally(() => offlinePromise = null)
    }
    return await offlinePromise
}