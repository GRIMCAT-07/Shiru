import { expose, proxy } from 'comlink'

/** @typedef {import('extensions/index.d.ts').TorrentQuery} Options */
/** @typedef {import('extensions/index.d.ts').TorrentResult} Result */
/** @typedef {import('/extensions/example.js').default} AbstractSource */

class Worker {
  id
  source
  cache = new Map()

  /**
   * Load and validate the source from code
   * @returns {Promise<{ validated: true } | { validated: false, error: string }>}
   */
  async initialize(id, module) {
    try {
      let source
      if (id.startsWith('file:')) source = (await import(/* webpackIgnore: true */ module)).default
      else {
        const blob = new Blob([module], { type: 'application/javascript' })
        const blobUrl = URL.createObjectURL(blob)
        source = (await import(/* webpackIgnore: true */ blobUrl)).default
      }
      this.id = id
      this.source = source
      if (!(await source.validate())) return { validated: false, error: 'Source #validate() failed' }
      return { validated: true }
    } catch (err) {
      return { validated: false, error: err.message }
    }
  }

  /**
   * @param {Options} options
   * @param {{ movie: boolean, batch: boolean }} types
   * @param {boolean} online
   * @param {{enabled: boolean}} sourceOptions
   */
  async query (options, types, online, sourceOptions) {
    /** @type {Promise<{ results: Result[], errors: string[] }>[]} */
    const promises = []
    if (!sourceOptions?.enabled) return { results: [], errors: [{ message: 'Extension is not enabled.. skipping...' }] }

    const cacheKey = JSON.stringify({ options, types })
    const cached = this.cache.get(cacheKey)
    if (cached && (((Date.now() - cached.timestamp) <= 90000) || !online)) {
      console.debug(`worker:${this.id} The previously cached extension results are less than two minutes old, returning cached results...`)
      return cached.query
    }

    promises.push(this._querySource(this.source, options, types))
    /** @type {Result[]} */
    const results = []
    const errors = []
    for (const res of await Promise.all(promises)) {
      results.push(...res.results)
      errors.push(...res.errors)
    }
    const noResults = (!online || (!results?.length && !errors?.length)) ? [{ message: 'Source ' + this.id + ' found no results.' }] : null
    if (online && !errors?.length) this.cache.set(cacheKey, { query: { results, errors: noResults || errors }, timestamp: Date.now() })
    return { results, errors: noResults || errors }
  }

  /**
   * @param {AbstractSource} source
   * @param {Options} options
   * @param {{ movie: boolean, batch: boolean }} types
   * @returns {Promise<{ results: Result[], errors: string[] }>}
   */
  async _querySource (source, options, { movie, batch }) {
    const promises = []
    promises.push(source.single(options))
    if (movie) promises.push(source.movie(options))
    if (batch) promises.push(source.batch(options))

    const results = []
    const errors = []
    for (const result of await Promise.allSettled(promises)) {
      if (result.status === 'fulfilled') {
        results.push(...result.value)
      } else {
        console.debug(result)
        errors.push('Source ' + this.id + ' failed to load results:\n' + result.reason.message)
      }
    }

    return { results, errors }
  }

  async validate() {
    return !!(await this.source.validate())
  }

  terminate() {
    self.close()
  }
}

expose(proxy(new Worker()))