<script context='module'>
  import { settings } from '@/modules/settings.js'
  import { matchPhrase, createListener } from '@/modules/util.js'
  import { sanitiseTerms } from '@/views/TorrentSearch/TorrentCard.svelte'
  import { add } from '@/modules/torrent.js'
  import { nowPlaying as currentMedia } from '@/views/Player/MediaHandler.svelte'
  import { animeSchedule } from '@/modules/animeschedule.js'
  import { cache, caches } from '@/modules/cache.js'
  import { getMediaMaxEp } from '@/modules/anime.js'
  import { dedupe, getResultsFromExtensions } from '@/modules/extensions/handler.js'
  import { anilistClient } from '@/modules/anilist.js'
  import { click } from '@/modules/click.js'
  import { X, Search, EllipsisVertical, Timer, Clapperboard, MonitorCog, ArrowDownWideNarrow, ChevronLeft, ChevronUp, ChevronDown } from 'lucide-svelte'
  import { toast } from 'svelte-sonner'
  import Debug from 'debug'

  const debug = Debug('ui:torrents')

  /** @typedef {import('@/modules/al.d.ts').Media} Media */
  /** @typedef {import('anitomyscript').AnitomyResult} AnitomyResult */
  /** @typedef {import('extensions/index.d.ts').TorrentResult} Result */

  /** @param {Media} media */
  function isMovie (media) {
    if (!media) return false
    if (media.format === 'MOVIE') return true
    if ([...Object.values(media.title), ...media.synonyms].some(title => title?.toLowerCase().includes('movie'))) return true
    // if (!getParentForSpecial(media)) return true // TODO: this is good for checking movies, but false positives with normal TV shows
    return media.duration > 80 && media.episodes === 1
  }

  /**
   * @param {AnitomyResult} result
   * @param {string} audioLang
   */
  function getRequestedAudio(result, audioLang) {
    const terms = sanitiseTerms(result)
    const checkTerm = (term, keyword) => (Array.isArray(term.text) ? term.text : [term.text]).some(text => text.toLowerCase().includes(keyword.toLowerCase()))
    const exactMatch = terms.some(term => checkTerm(term, audioLang))
    const dualAudio = terms.some(term => checkTerm(term, 'dual'))
    return exactMatch || dualAudio
  }

  /**
   * @param {Result[]} results
   * @param {string} audioLang
   */
  function getBest(results, audioLang) {
    const bestRequestedAudio = audioLang !== 'jpn' && results.find(result => getRequestedAudio(result.parseObject, audioLang) && result.seeders > 9)
    const altRequestedAudio = audioLang !== 'jpn' && results.find(result => getRequestedAudio(result.parseObject, audioLang) && result.seeders > 1)
    const bestGenericAudio = results.find(result => result.type === 'best' || result.type === 'alt' && result.seeders > 9)
    return bestRequestedAudio || altRequestedAudio || bestGenericAudio || results[0]
  }

  function filterResults(results, searchText) {
    if (!searchText?.length) return results
    return results.filter(({ title }) => matchPhrase(searchText, title, 0.4, false, true)) || []
  }

  /**
   * @param {Result[]} results
   * @param {string} sort
   */
  function sortResults(results, sort) {
    if (!results) return { results: [], hiddenResults: [] }
    const deduped = Array.from(dedupe(results))
    return {
      results: deduped.filter(entry => entry.seeders > 0).sort((a, b) => {
        switch (sort) {
          case 'smallest': return a.size - b.size
          case 'best': return (b.type === 'best') - (a.type === 'best') || (b.type === 'alt') - (a.type === 'alt')
          case 'batch': return (b.type === 'batch') - (a.type === 'batch')
          case 'new': return new Date(b.date) - new Date(a.date)
          case 'old': return new Date(a.date) - new Date(b.date)
          case 'seeders':
          default: return b.seeders - a.seeders
        }
      }),
      hiddenResults: deduped.filter(entry => entry.seeders === 0)
    }
  }

  const languages = [
    { value: 'jpn', label: 'Japanese' },
    { value: 'eng', label: 'English' },
    { value: 'chi', label: 'Chinese' },
    { value: 'por', label: 'Portuguese' },
    { value: 'spa', label: 'Spanish' },
    { value: 'ger', label: 'German' },
    { value: 'pol', label: 'Polish' },
    { value: 'cze', label: 'Czech' },
    { value: 'dan', label: 'Danish' },
    { value: 'gre', label: 'Greek' },
    { value: 'fin', label: 'Finnish' },
    { value: 'fre', label: 'French' },
    { value: 'hun', label: 'Hungarian' },
    { value: 'ita', label: 'Italian' },
    { value: 'kor', label: 'Korean' },
    { value: 'dut', label: 'Dutch' },
    { value: 'nor', label: 'Norwegian' },
    { value: 'rum', label: 'Romanian' },
    { value: 'rus', label: 'Russian' },
    { value: 'slo', label: 'Slovak' },
    { value: 'swe', label: 'Swedish' },
    { value: 'ara', label: 'Arabic' },
    { value: 'idn', label: 'Indonesian' }
  ]
</script>

<script>
  import TorrentCard from '@/views/TorrentSearch/TorrentCard.svelte'
  import TorrentSkeletonCard from '@/views/TorrentSearch/TorrentSkeletonCard.svelte'
  import ErrorCard from '@/components/cards/ErrorCard.svelte'
  import { onDestroy } from 'svelte'
  import { writable } from 'simple-store-svelte'

  /** @type {{ media: Media, episode?: number }} */
  export let search
  export let close

  let countdown = 5
  let timeoutHandle

  /**
   * @param {ReturnType<typeof getBest>} promise
   * @param {boolean} ready
   */
  async function autoPlay (promise, ready) {
    const best = await promise
    if (!search || !best || !ready) return
    if ($settings.rssAutoplay) {
      clearTimeout(timeoutHandle)
      const decrement = () => {
        countdown--
        if (countdown === 0) {
          play(best)
        } else {
          timeoutHandle = setTimeout(decrement, 1000)
        }
      }
      timeoutHandle = setTimeout(decrement, 1000)
    }
  }

  function dubFinished() {
    const airingMedia = animeSchedule.dubAiring.value?.find(entry => entry.media?.media?.id === search.media.id)
    return !airingMedia || (airingMedia.episodeNumber === search.media.episodes && (new Date().getTime() >= new Date(airingMedia.episodeDate).getTime()))
  }

  const movie = isMovie(search.media)
  let batch = search.media.status === 'FINISHED' && (!settings.value.preferDubs || dubFinished()) && !movie

  const results = writable({})
  function addResults(newItems, source) {
    if (!newItems?.length) return ''
    results.update(r => ({ ...r, torrents: [...(r?.torrents ?? []), ...newItems.map(item => ({ ...item, source }))] }))
    return ''
  }

  async function queryExtensions(request, resolution) {
    $results = {}
    debug(`Querying extensions for torrent sources for ${search?.media?.id}`)
    let promises
    try {
      promises = await getResultsFromExtensions({ ...request, batch, movie, resolution })
    } catch (error) {
      if (search !== null && search.media?.id === request?.media?.id && search.episode === request?.episode) {
        errors = Promise.resolve({ errors: [error] })
        results.update(r => ({...r, resolved: true}))
      }
    }
    if (search === null || search.media?.id !== request?.media?.id) return null
    debug(`Query promises from extensions have been accepted for ${search?.media?.id}`)
    return promises
  }

  async function getErrors(request, promises) {
    const queries = await promises
    if (!queries) return null
    const uniqueErrors = new Set()
    await (async () => {
      (await Promise.all(Array.from(queries, ([_, extension]) => extension.promise))).forEach((result) => {
        if (result.errors && result.errors.length > 0) result.errors.forEach((error) => uniqueErrors.add(error.message))
      })
    })()
    if (search === null || search.media?.id !== request?.media?.id || search.episode !== request?.episode) return null
    results.update(r => ({ ...r, resolved: true }))
    debug(`All query promises have successfully been resolved for ${search?.media?.id}:E${search?.episode}`, Array.from(uniqueErrors))
    if (JSON.stringify(Array.from(uniqueErrors)).match(/found no results/i) && (getMediaMaxEp(search?.media, true) < search?.episode)) return { errors: [ { message: `${anilistClient.title(search.media)} ${search.media?.format !== 'MOVIE' || (getMediaMaxEp(search?.media, false) > 1) ? `Episode ${search.media.nextAiringEpisode.episode}` : ``} hasn't released yet! ${search?.media?.nextAiringEpisode?.timeUntilAiring ? `\n${search.media?.format !== 'MOVIE' || (getMediaMaxEp(search?.media, false) > 1) ? `This episode` : `This movie`} will be released on ${new Date(Date.now() + search.media.nextAiringEpisode.timeUntilAiring * 1000).toDateString()}` : ''}` }]}
    return { errors: Array.from(uniqueErrors).map((message) => ({ message })) }
  }

  $: resolution = $settings.rssQuality
  $: queries = queryExtensions({...search}, resolution)
  $: errors = getErrors({...search}, queries)

  $: queryResults = sortResults($results?.torrents, $settings.torrentSort)
  $: lookup = queryResults?.results
  $: best = getBest(lookup, $settings.audioLanguage)

  $: lookupHidden = queryResults?.hiddenResults
  $: viewHidden = false

  $: if (!$settings.rssAutoplay) clearTimeout(timeoutHandle)
  $: autoPlay(best, $results?.resolved)

  const lastMagnet = cache.getEntry(caches.HISTORY, 'lastMagnet')?.[`${search?.media?.id}`]?.[`${search?.episode}`] || cache.getEntry(caches.HISTORY, 'lastMagnet')?.[`${search?.media?.id}`]?.batch
  let searchText = ''

  /** @param {import('extensions/index.d.ts').TorrentResult} result */
  function play (result) {
    $currentMedia = search
    $currentMedia.accuracy = result.accuracy
    if (!isNaN(result.seeders) && result.seeders < 10) toast('Availability Warning', { description: 'This release is poorly seeded and likely will have playback issues such as buffering!' })
    const existingMagnets = cache.getEntry(caches.HISTORY, 'lastMagnet') || {}
    cache.setEntry(caches.HISTORY, 'lastMagnet', { ...existingMagnets, [search?.media?.id]: !result.parseObject?.episode_number || Array.isArray(result.parseObject.episode_number) ? { [`batch`]: result } : { ...(existingMagnets[search?.media?.id] || {}), [`${search.episode}`]: result } })
    add(result.link, { media: search?.media, episode: search?.episode })
    close()
  }

  function episodeInput ({ target }) {
    const episode = Number(target.value)
    if (episode || episode === 0) {
      search.episode = episode
    }
  }

  function autoPlayToggle() {
    $settings.rssAutoplay = !$settings.rssAutoplay
    if ($settings.rssAutoplay) countdown = 5
  }

  const showOptions = writable(false)
  function toggleDropdown({ target }) {
    target.classList.toggle('active')
    target.closest('.dropdown').classList.toggle('show')
  }

  $: {
    if ($showOptions) {
      const { reactive, init } = createListener([`primary`])
      init(true, true)
      reactive.subscribe(value => {
        if (!value) {
          showOptions.set(false)
          init(false, true)
        }
      })
    }
  }

  onDestroy(() => {
    clearTimeout(timeoutHandle)
    showOptions.set(false)
    viewHidden = false
    $results = {}
    search = null
  })
</script>

<div class='controls w-full bg-very-dark position-sticky top-0 z-10 pt-20 pb-10 px-30 mb-10'>
  <div class='d-flex'>
    <h3 class='mb-0 font-weight-bold text-white title mr-5'>{anilistClient.title(search?.media)}</h3>
    <button type='button' class='btn btn-square bg-dark ml-auto d-flex align-items-center justify-content-center rounded-2 flex-shrink-0' use:click={close}><X size='1.7rem' strokeWidth='3'/></button>
    {#if search.media.bannerImage || search.media.trailer?.id}
      <div class='position-absolute top-0 left-0 w-full h-full z--1'>
        <div class='position-absolute w-full h-full overflow-hidden' >
          <object class='img-cover w-full h-full' data={search.media.bannerImage || (search.media.trailer?.id && `https://i.ytimg.com/vi/${search.media.trailer?.id}/maxresdefault.jpg`) || ' '}>
            <object class='img-cover w-full h-full' data={(search.media.trailer?.id && `https://i.ytimg.com/vi/${search.media.trailer?.id}/hqdefault.jpg`) || ' '}>
              <img class='img-cover w-full h-full' src={' '} alt='bannerImage'> <!-- trailer no longer exists... hide all images. -->
            </object>
          </object>
        </div>
        <div class='position-absolute top-0 left-0 w-full h-full' style='background: var(--torrent-banner-gradient)' />
      </div>
    {/if}
  </div>
  <div class='input-group mt-20 h-40'>
    <Search size='2.6rem' strokeWidth='2.5' class='position-absolute z-10 text-dark-light h-full pl-10 pointer-events-none' />
    <input
      type='search'
      class='form-control bg-dark pl-40 pr-20 rounded-3 h-40'
      autocomplete='off'
      data-option='search'
      placeholder='Filter torrents by text, or manually specify one by pasting a magnet link or torrent file' bind:value={searchText} />
    <div class='dropdown primary dropleft with-arrow position-absolute z-20 h-full right-0' use:click={() => {showOptions.set(!$showOptions)}}>
      <button type='button' class='options h-full bg-transparent border-0 pointer p-0 pr-10 muted d-flex align-items-center'><EllipsisVertical size='2rem' /></button>
      <div class='position-absolute visibility top-0 text-capitalize hm-40 text-nowrap' class:hidden={!$showOptions}>
        <div class='dropdown dropleft with-arrow z-20 pointer bg-dark p-5 rounded-1 option' aria-label='Preferred Audio Language' title='Preferred Audio Language' use:click={toggleDropdown}>
          <div class='d-flex align-items-center justify-content-center pr-5'><ChevronLeft size='2rem' strokeWidth={2.5}  /><span class='ml-10'>Preferred Audio</span></div>
          <div class='dropdown-menu dropdown-menu-right text-capitalize hm-400 text-nowrap'>
            <div class='custom-radio overflow-y-auto overflow-x-hidden hm-400'>
              {#each languages as language}
                <input name='audio-radio-set' type='radio' id='audio-{language.value}-radio' value={language.value} checked={language.value === $settings.audioLanguage} />
                <label for='audio-{language.value}-radio' use:click={(event) => { $settings.audioLanguage = language.value }} class='pb-5'>
                  {language.label}
                </label>
              {/each}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class='row mt-10'>
    <div class='col-12 col-sm-6 d-flex align-items-center justify-content-center justify-content-sm-start'>
      <div class='d-flex align-items-center mr-5 w-140 overflow-hidden' title='Toggle Autoplay'>
        <Timer size='2.75rem' class='position-absolute z-10 text-dark-light pl-10 pointer-events-none' />
        <button type='button' class='form-control w-full bg-dark pointer pl-15 control text-nowrap' use:click={() => autoPlayToggle()}>
        <span class:ml-20={!$settings.rssAutoplay} class:ml-10={$settings.rssAutoplay}>
          {#if $settings.rssAutoplay}
            Autoplay [{countdown}]
          {:else}
            Autoplay [Off]
          {/if}
        </span>
        </button>
      </div>
      <div class='d-flex align-items-center mr-5' style='width: calc(5.5rem + {String(search.episode).length * .75}rem) !important'  title='Episode'>
        <Clapperboard size='2.75rem' class='position-absolute z-10 text-dark-light pl-10 pointer-events-none' />
        <input type='number' inputmode='numeric' pattern='[0-9]*' class='form-control bg-dark pl-40 control' placeholder='5' value={search.episode} on:input={episodeInput} disabled={(!search.episode && search.episode !== 0) || movie} />
      </div>
    </div>
    <div class='col-12 col-sm-6 d-flex align-items-center mt-5 justify-content-center mt-sm-0 justify-content-sm-end'>
      <div class='d-flex align-items-center pr-5' title='Sorting Preference'>
        <ArrowDownWideNarrow size='2.75rem' class='position-absolute z-10 text-dark-light pl-10 pointer-events-none' />
        <select class='form-control w-full bg-dark pl-40 control' bind:value={$settings.torrentSort}>
          <option value='seeders' selected>Seeders</option>
          <option value='smallest' selected>Smallest</option>
          <option value='new' selected>Newest</option>
          <option value='old' selected>Oldest</option>
          <option value='batch' selected>Batch</option>
          <option value='best' selected>Best</option>
        </select>
      </div>
      <div class='d-flex align-items-center' title='Video Quality'>
        <MonitorCog size='2.75rem' class='position-absolute z-10 text-dark-light pl-10 pointer-events-none' />
        <select class='form-control w-full bg-dark pl-40 control' bind:value={$settings.rssQuality}>
          <option value='1080' selected>1080p</option>
          <option value='720'>720p</option>
          <option value='540'>540p</option>
          <option value='480'>480p</option>
          <option value=''>Any</option>
        </select>
      </div>
    </div>
  </div>
</div>
<div class='mt-10 mb-sm-10 px-30'>
{#if $results?.resolved && !$results?.torrents?.length}
  <div class='mt-80'>
    <ErrorCard promise={errors} />
  </div>
{:else}
  {#if $results?.torrents?.length && (!best || !Object.values(best)?.length)}
    <TorrentSkeletonCard />
  {:else if $results?.torrents?.length}
    <TorrentCard type='best' countdown={$settings.rssAutoplay && $results?.resolved ? countdown : -1} result={best} {play} media={search.media} episode={search.episode} />
    {#if lastMagnet}
      {#each filterResults(lookup, searchText) as result}
        {#if ((result.link === lastMagnet.link) || (result.hash === lastMagnet.hash)) && result.seeders > 1 && ((best?.link !== lastMagnet.link) && (best?.hash !== lastMagnet.hash)) }
          <TorrentCard type='magnet' result={result} {play} media={search.media} episode={search.episode} />
        {/if}
      {/each}
    {/if}
  {/if}
  {#each filterResults(lookup, searchText) as result}
    {#if ((best?.link !== result.link) && (best?.hash !== result.hash)) && (!lastMagnet || (((result.link !== lastMagnet.link) || (result.hash !== lastMagnet.hash)) || result.seeders <= 1))}
      <TorrentCard {result} {play} media={search.media} episode={search.episode} />
    {/if}
  {/each}
  {#if lookupHidden?.length}
    <button type='button' class='mb-10 control h-50 btn w-full p-5 rounded-3 d-flex align-items-center font-size-16 font-weight-semi-bold overflow-hidden' class:bg-dark={!viewHidden} class:bg-primary={viewHidden} use:click={()=> { viewHidden = !viewHidden }}>
      <span class='ml-20'>{lookupHidden?.length} Unseeded Results (Unavailable)</span>
      <svelte:component this={ viewHidden ? ChevronUp : ChevronDown } class='ml-auto mr-10' size='2.2rem' />
    </button>
    {#if viewHidden}
      {#each filterResults(lookupHidden, searchText) as result}
        {#if ((best?.link !== result.link) && (best?.hash !== result.hash)) && (!lastMagnet || (((result.link !== lastMagnet.link) || (result.hash !== lastMagnet.hash)) || result.seeders <= 1))}
          <div class='unavailable'><TorrentCard {result} {play} media={search.media} episode={search.episode} /></div>
        {/if}
      {/each}
    {/if}
  {/if}
  {#if queries}
    {#await queries then queries}
      {#each queries as [key, extension] (key)}
        {#await extension.promise}
          <TorrentSkeletonCard name={extension.name} icon={extension.icon || 'none'} />
        {:then resolved}
          {addResults(resolved, { name: extension.name, icon: extension.icon })}
        {/await}
      {/each}
    {/await}
  {/if}
  {#if !$results?.torrents?.length}
    {#each Array.from({ length: 10 }) as _}
      <TorrentSkeletonCard />
    {/each}
  {/if}
{/if}
</div>

<style>
  .unavailable {
    opacity: 0.6;
  }
  .hidden {
    opacity: 0;
    visibility: hidden;
  }
  .visibility {
    margin-top: .4rem;
    margin-left: -15.5rem;
    transition: opacity 0.1s ease-in;
  }

  .muted {
    color: var(--gray-color-light)
  }
  .muted:hover {
    color: var(--highlight-color)
  }

  .option {
    border: .1rem solid var(--dark-color-light);
  }
  .option:hover {
    border: .1rem solid var(--highlight-color);
  }

  .control {
    border: .1rem solid transparent;
  }
  .control:hover {
    border: .1rem solid var(--highlight-color);
  }

  .controls {
    box-shadow: 0 1.2rem 1.2rem #131416;
  }
  .title {
    display: inline-block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    text-shadow: 2px 2px 4px rgba(0, 0, 0, 1);
  }
  .pl-40 {
    padding-left: 4rem;
  }
  .mt-80 {
    margin-top: 8rem;
  }
  .w-140 {
    width: 14rem;
  }
  .h-40 {
    height: 4rem;
  }
  .px-30 {
    padding-left: 3rem;
    padding-right: 3rem;
  }
</style>