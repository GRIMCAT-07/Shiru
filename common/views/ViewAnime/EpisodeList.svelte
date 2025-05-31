<script context='module'>
  import { animeSchedule } from '@/modules/animeschedule.js'
  import { malDubs } from '@/modules/animedubs.js'
  import { settings } from '@/modules/settings.js'
  import { past } from '@/modules/util.js'

  async function dubbedEpisode(i, media) {
    if (!settings.value.cardAudio) return
    const episode = i + 1
    const entry = (await animeSchedule.dubAiringLists.value)?.find(entry => entry.media?.media?.id === media.id)
    const episodeEntry = (await animeSchedule.dubAiredLists.value)?.find(entry => entry?.id === media.id && entry?.episode?.aired === episode)
    if (entry && !episodeEntry) {
      const airingSchedule = entry?.media?.media?.airingSchedule?.nodes[episode - 1] || entry?.media?.media?.airingSchedule?.nodes.find((entry) => entry.episode === episode) || entry?.airingSchedule?.media?.media?.nodes[0]
      const delayed = !!(entry.episodeDate && (((new Date(entry.delayedUntil) >= new Date(entry.episodeDate)) && ((new Date(entry.delayedFrom) > new Date(entry.episodeDate)) || (new Date(entry.delayedUntil).getTime() === new Date(entry.episodeDate).getTime()) || ((new Date(entry.delayedFrom) <= new Date(entry.episodeDate)) && (entry.episodeNumber === entry.media?.media?.airingSchedule?.nodes[0].episode) && (new Date(entry.delayedUntil).getTime() === new Date(entry.media?.media?.airingSchedule?.nodes[0].airingAt).getTime()))) && (new Date(entry.delayedUntil) > new Date())) || entry.delayedIndefinitely))
      const numberOfEpisodes = entry?.subtractedEpisodeNumber ? (entry.episodeNumber - entry.subtractedEpisodeNumber) : 1
      if (entry.episodeDate && (entry.episodeNumber <= episode)) {
        return { airdate: (delayed ? entry.delayedUntil : entry.episodeDate), text: `${entry.delayedIndefinitely && !entry.status?.toUpperCase()?.includes('FINISHED') ? 'Suspended' : entry.delayedIndefinitely ? 'Not Planned' : ((episode > entry.episodeNumber) && (numberOfEpisodes > 4) && !entry.unaired) ? 'In Production' : since(past(new Date(delayed ? entry.delayedUntil : entry.episodeDate), entry.episodeNumber >= episode ? 0 : episode - entry.episodeNumber, true)) + (delayed ? ` (${entry.delayedText || 'Delayed'})` : '')}`, delayed: delayed }
      } else if (airingSchedule && airingSchedule.episode <= episode) {
        return { airdate: airingSchedule.airingAt, text: `${since(new Date(airingSchedule.airingAt))} ${(delayed ? `(${entry.delayedText || 'Delayed'})` : '')}`, delayed: delayed && !entry.delayedIndefinitely }
      } else {
        return { airdate: new Date().toISOString(), text: `Finished`, delayed: false }
      }
    } else if (episodeEntry) {
      return { airdate: episodeEntry.episode.airedAt, text: `${since(new Date(episodeEntry.episode.airedAt))}`, delayed: false }
    } else if (malDubs.dubLists.value?.incomplete?.includes(media.idMal) && (await animeSchedule.dubAiredLists.value).find(entry => entry?.id === media.id && entry?.episode?.aired === 1)) {
      return { text: `Not Planned`, delayed: true }
    } else if (!entry && !episodeEntry && (media.seasonYear >= new Date().getFullYear()) && malDubs.isDubMedia(media)) {
      return { text: `In Production`, delayed: false }
    }
  }
</script>

<script>
  import { since, monthDay, matchPhrase } from '@/modules/util.js'
  import { click } from '@/modules/click.js'
  import { onMount, onDestroy } from 'svelte'
  import { episodeByAirDate } from '@/modules/extensions/handler.js'
  import { liveAnimeProgress } from '@/modules/animeprogress.js'
  import { episodesList } from '@/modules/episodes.js'
  import { getAniMappings, hasZeroEpisode, durationMap } from '@/modules/anime.js'
  import EpisodeSkeletonCard from '@/views/ViewAnime/EpisodeListSkeleton.svelte'
  import AudioLabel from '@/views/ViewAnime/AudioLabel.svelte'

  export let media

  export let episodeOrder = true

  export let watched = false

  export let episodeCount

  export let userProgress = 0

  export let play

  export let episodeLoad = null

  export let mobileList = false

  export let episodeList = []

  let mobileWaiting = null

  $: id = media.id
  $: idMal = media.idMal
  $: duration = media.duration

  const episodeRx = /Episode (\d+) - (.*)/

  const animeProgress = liveAnimeProgress(id)

  let maxEpisodes = 15
  let currentEpisodes = []
  function handleScroll(event) {
    const container = event.target
    if (currentEpisodes.length !== episodeList.length && container.scrollTop + container.clientHeight + 80 >= container.scrollHeight) {
      const nextBatch = (episodeOrder ? episodeList : [...episodeList]?.reverse())?.slice(currentEpisodes.length, currentEpisodes.length + maxEpisodes)
      currentEpisodes = [...new Set([...currentEpisodes, ...nextBatch])]
    }
  }

  async function load () {
    const mappings = await getAniMappings(id) || {}
    const { episodes, specialCount, episodeCount: newEpisodeCount } = mappings

    /** @type {{ zeroEpisode: object; airingAt: number; episode: number; filler?: boolean; dubAiring?: object; }[]} */
    episodeList = Array.from({ length: (newEpisodeCount > episodeCount ? newEpisodeCount : episodeCount) }, (_, i) => ({
      episode: i + 1, image: null, summary: null, rating: null, title: null, length: null, airdate: null, airingAt: null, filler: episodesList.getSingleEpisode(idMal, (i + 1)), dubAiring: dubbedEpisode(i, media)
    }))
    let alEpisodes = episodeList

    // fallback: pull episodes from airing schedule if anime doesn't have expected episode count
    if (!(media.episodes && media.episodes === newEpisodeCount && media.status === 'FINISHED')) {
      const settled = media.airingSchedule
      if (settled?.length >= newEpisodeCount) {
        alEpisodes = settled.map((episode, i) => ({
          ...episode, airingAt: episode.airingAt, episode: episode.episode, filler: episodesList.getSingleEpisode(idMal, (i + 1)), dubAiring: dubbedEpisode(i, media)
        }))
      } else if (settled?.length) {
        const settledMap = settled.reduce((acc, { airingAt, episode }) => {
          acc[episode] = { airingAt, episode }
          return acc
        }, {})
        alEpisodes = alEpisodes.map((episode, i) => {
          const settledData = settledMap?.[episode.episode]
          if (settledData) return { ...episode, airingAt: settledData.airingAt ?? episode.airingAt, episode: settledData.episode ?? episode.episode, filler: episodesList.getSingleEpisode(idMal, (i + 1)), dubAiring: dubbedEpisode(i, media)}
          return episode
        })
      }
    }

    if ((alEpisodes.length < episodeCount) || (!alEpisodes.length && !episodeCount)) {
      const eps = await episodesList.getEpisodeData(idMal)
      if (eps?.length > 0) {
        const lastId = eps[eps.length - 1].episode_id
        alEpisodes = Array.from({ length: (lastId) }, (_, i) => ({
          episode: i + 1, image: null, summary: null, rating: null, title: (lastId <= 100 ? eps.find(e => e.episode_id === (i + 1)) : episodesList.getSingleEpisode(idMal, (i + 1)))?.title, length: null, airdate: null, airingAt: (lastId <= 100 ? eps.find(e => e.episode_id === (i + 1)) : episodesList.getSingleEpisode(idMal, (i + 1)))?.aired, filler: episodesList.getSingleEpisode(idMal, (i + 1)), dubAiring: dubbedEpisode(i, media)
        }))
      } else if ((media?.status === 'RELEASING' || media?.status === 'FINISHED')) {
        alEpisodes = Array.from({ length: (media?.mediaListEntry?.progress > 0 ? media?.mediaListEntry?.progress : 1) }, (_, i) => ({
          episode: i + 1, image: null, summary: null, rating: null, title: null, length: null, airdate: null, airingAt: null, filler: episodesList.getSingleEpisode(idMal, (i + 1)), dubAiring: dubbedEpisode(i, media)
        }))
      }
    }

    let lastValidAirDate = null
    let lastDuration = durationMap[media?.format]
    let zeroAsFirstEpisode
    const zeroEpisode = await hasZeroEpisode(media, mappings)
    const kitsuMappings = await episodesList.getKitsuEpisodes(media.id)
    if (zeroEpisode) {
      alEpisodes.unshift({ episode: 0, title: zeroEpisode[0].title, airingAt: media.airingSchedule?.nodes?.find(node => node.episode === 1)?.airingAt || zeroEpisode[0].airingAt, filler: episodesList.getSingleEpisode(idMal, 0), dubAiring: dubbedEpisode(0, media)})
    }
    for (const { episode, title: oldTitle, airingAt, filler, dubAiring } of alEpisodes) {
      const airingPromise = await airingAt
      const alDate = airingPromise && new Date(typeof airingPromise === 'number' ? (airingPromise || 0) * 1000 : (airingPromise || 0))

      // validate by air date if the anime has specials AND doesn't have matching episode count
      const needsValidation = !(!specialCount || (media.episodes && media.episodes === newEpisodeCount && episodes && episodes[Number(episode)]))
      const { image, summary, overview, rating, title: newTitle, length, airdate } = needsValidation ? episodeByAirDate(null, episodes, episode) : ((episodes && episodes[Number(episode)]) || {})
      const kitsuEpisode = kitsuMappings?.data?.find(ep => ep?.attributes?.number === episode)?.attributes
      const streamingTitle = !media.streamingEpisodes?.find(ep => episodeRx.exec(ep.title) && Number(episodeRx.exec(ep.title)[1]) === (media?.episodes + 1)) && media.streamingEpisodes?.find(ep => episodeRx.exec(ep.title) && Number(episodeRx.exec(ep.title)[1]) === episode && episodeRx.exec(ep.title)[2] && !episodeRx.exec(ep.title)[2].toLowerCase().trim().startsWith('episode'))
      const streamingThumbnail = media.streamingEpisodes?.find(ep => episodeRx.exec(ep.title) && Number(episodeRx.exec(ep.title)[1]) === episode)?.thumbnail
      const title = episode === 0 ? oldTitle : newTitle?.en || oldTitle?.en || (await episodesList.getSingleEpisode(idMal, episode))?.title || episodeRx.exec(streamingTitle?.title)?.[2]
      lastDuration = length || duration || lastDuration

      // fix any weird dates when maintainers are lazy.
      const scheduledEntry = media?.airingSchedule?.nodes.find((entry) => entry.episode === episode)
      const scheduledDate = scheduledEntry ? new Date(scheduledEntry.airingAt * 1000) : null
      let validatedAiringAt = lastValidAirDate ? (((scheduledDate >= lastValidAirDate) || ((scheduledDate?.getDate() >= lastValidAirDate.getDate()) && (scheduledDate?.getMonth() >= lastValidAirDate.getMonth()) && (scheduledDate?.getFullYear() >= lastValidAirDate.getFullYear()))) ? scheduledDate : null) : scheduledDate
      if (!validatedAiringAt) {
        const fallbackAirDate = airdate ? new Date(airdate) : null
        validatedAiringAt = lastValidAirDate ? ((alDate || fallbackAirDate) >= lastValidAirDate) || (((alDate || fallbackAirDate)?.getDate() >= lastValidAirDate.getDate()) && ((alDate || fallbackAirDate)?.getMonth() >= lastValidAirDate.getMonth()) && ((alDate || fallbackAirDate)?.getFullYear() >= lastValidAirDate.getFullYear())) ? (alDate || fallbackAirDate) : null : (alDate || fallbackAirDate)
        if (validatedAiringAt) {
          lastValidAirDate = validatedAiringAt
        }
      } else {
        lastValidAirDate = validatedAiringAt
      }

      let zeroSummary
      if (episode === 0) { // might get lucky and randomly find the zero episode from anilist mappings
        const findZeroEpisode = (title, data) => {
          for (const route in data) if (matchPhrase(data[route]?.title?.en, title, 0.4)) return data[route]
          return null
        }
        const zeroEpisode = findZeroEpisode(title, mappings?.episodes)
        zeroSummary = zeroEpisode?.summary || zeroEpisode?.[0]?.summary || 'This is a zero episode which means a prequel, prologue or a teaser which may be important to the story.'
        lastDuration = zeroEpisode?.length || zeroEpisode?.[0]?.length || lastDuration
      }
      if (zeroEpisode && episode === 1 && /episode\s*0/i.test(title || kitsuEpisode?.titles?.en_us || kitsuEpisode?.titles?.en_jp || newTitle?.jp || oldTitle?.jp)) {
        zeroAsFirstEpisode = true
        continue // skip setting this episode as it's Episode 0
      }

      const episodeNumber = episode - (zeroAsFirstEpisode ? 1 : 0)
      episodeList[episodeNumber - (!zeroEpisode ? 1 : 0)] = { zeroEpisode, episode: episodeNumber, image: (media?.status === 'FINISHED' || new Date(validatedAiringAt).getTime() <= (Date.now() + 7 * 24 * 60 * 60 * 1000)) ? episode === 0 ? zeroEpisode[0]?.thumbnail : episodeList.some((ep) => ep.image === (image || kitsuEpisode?.thumbnail?.original || streamingThumbnail) && ep.episode !== episodeNumber) ? null : (image || kitsuEpisode?.thumbnail?.original || streamingThumbnail) : null, summary: (media?.status === 'FINISHED' || new Date(validatedAiringAt).getTime() <= Date.now()) ? episode === 0 ? (zeroSummary || summary) : episodeList.some((ep) => ep.summary === (summary || overview || kitsuEpisode?.synopsis || kitsuEpisode?.description) && ep.episode !== episodeNumber) ? null : (summary || overview || kitsuEpisode?.synopsis || kitsuEpisode?.description) : `This episode will be released on ${monthDay(validatedAiringAt)}.`, rating, title: (media?.status === 'FINISHED' || new Date(validatedAiringAt).getTime() <= (Date.now() + 7 * 24 * 60 * 60 * 1000)) ? title || kitsuEpisode?.titles?.en_us || kitsuEpisode?.titles?.en_jp || newTitle?.jp || oldTitle?.jp : null, length: lastDuration, airdate: validatedAiringAt, airingAt: validatedAiringAt, filler, dubAiring }
    }

    if (zeroEpisode && episodeList.length === alEpisodes.length) episodeList = episodeList.slice(0, -1)
    currentEpisodes = episodeList?.slice(0, maxEpisodes)
    return episodeList && episodeList?.length > 0 ? episodeList : null
  }

  $: if (media) {
    episodeList = []
    episodeOrder = true
    currentEpisodes = []
    mobileWaiting = null
    if (!mobileList) episodeLoad = load()
  }

  $: {
    if (episodeOrder) currentEpisodes = episodeList?.slice(0, maxEpisodes)
    else currentEpisodes = [...episodeList]?.reverse()?.slice(0, maxEpisodes)
  }

  let container
  $: if (id && container) container.scrollTo({top: 0, behavior: 'smooth'})
  function renderVisible() {
    if (!container || container.scrollHeight === 0 || container.clientHeight === 0) return
    if (currentEpisodes.length !== episodeList.length && !(container.scrollHeight > container.clientHeight)) {
      const nextBatch = (episodeOrder ? episodeList : [...episodeList]?.reverse())?.slice(currentEpisodes.length, currentEpisodes.length + maxEpisodes)
      currentEpisodes = [...new Set([...currentEpisodes, ...nextBatch])]
    }
  }

  function mobileWait(condition, interval = 1000) {
    if (mobileWaiting) return mobileList ? mobileWaiting : null
    mobileWaiting = new Promise(resolve => setTimeout(resolve, 1000))
    mobileWaiting = new Promise((resolve) => {
      const check = () => {
        if (mobileWaiting) {
          if (condition()) resolve()
          else setTimeout(check, interval)
        }
      }
      check()
    })
    return mobileWaiting
  }

  onMount(() => {
    setInterval(() => {
      if (!mobileList && episodeList?.length > maxEpisodes) renderVisible()
    }, 100)
  })

  onDestroy(() => {
    mobileWaiting = null
    episodeList = []
    episodeLoad = null
  })
</script>

<div bind:this={container} class='episode-list overflow-y-auto overflow-x-hidden {$$restProps.class}' on:scroll={handleScroll}>
  {#await (episodeLoad || mobileWait(() => episodeList?.length > 0 || !episodeList)?.then(() => episodeList))}
    {#each Array.from({ length: Math.max(Math.min(episodeCount || 0, maxEpisodes), 1) }) as _}
      <div class='w-full px-20 my-20 content-visibility-auto scale h-150'>
        <EpisodeSkeletonCard />
      </div>
    {/each}
  {:then _}
    {#if episodeList}
      {#each currentEpisodes as { zeroEpisode, episode, image, summary, rating, title, length, airdate, filler, dubAiring}, index}
        {#if media?.status === 'FINISHED' || (episodeOrder ? (index === 0 || ((new Date(currentEpisodes[index - 1]?.airdate).getTime() <= new Date().getTime()) || (currentEpisodes[index - 1]?.airdate === airdate))) : (index === currentEpisodes.length - 1 || ((new Date(currentEpisodes[index + 1]?.airdate).getTime() <= new Date().getTime())) || (currentEpisodes[index + 1]?.airdate === airdate)))}
          {#await Promise.all([title, filler, dubAiring])}
            {#each Array.from({length: Math.min(episodeCount || 0, maxEpisodes)}) as _, index}
              <div class='w-full px-20 content-visibility-auto scale h-150' class:my-20={!mobileList || index !== 0}>
                <EpisodeSkeletonCard/>
              </div>
            {/each}
          {:then [title, filler, dubAiring]}
            {@const unreleased = media?.status !== 'FINISHED' && new Date(airdate).getTime() > new Date()}
            {@const completed = !watched && userProgress >= (episode + (zeroEpisode ? 1 : 0))}
            {@const target = userProgress + 1 === (episode + (zeroEpisode ? 1 : 0))}
            {@const hasFiller = filler?.filler || filler?.recap}
            {@const progress = !watched && ($animeProgress?.[episode + (zeroEpisode ? 1 : 0)] ?? 0)}
            {@const resolvedTitle = episodeList.filter((ep) => ep.episode < episode).some((ep) => matchPhrase(ep.title, title, 0.1, true)) ? null : title}
            <div class='w-full content-visibility-auto scale my-20' class:opacity-half={completed} class:scale-target={target} class:px-20={!target} class:px-10={target} class:h-150={image || (summary && !unreleased)}>
              <div class='rounded-2 w-full h-full overflow-hidden d-flex flex-xsm-column flex-row position-relative {unreleased ? `unreleased not-allowed` : `pointer`}' class:border={target || hasFiller} class:bg-black={completed} class:border-secondary={hasFiller} class:bg-dark={!completed} use:click={() => play(episode)}>
                <div class="unreleased-overlay position-absolute top-0 left-0 right-0 h-full pointer-events-none rounded-2" class:d-none={!unreleased}/>
                {#if image}
                  <div class='h-full d-flex'>
                    <img alt='thumbnail' src={image} class='img-cover h-full'/>
                    {#if dubAiring}
                      <div class='position-relative d-none sm-label'>
                        <AudioLabel {media} episodeList={true} dubbed={dubAiring?.airdate && (new Date(dubAiring.airdate).getTime() <= new Date().getTime())} subbed={(airdate && (new Date(airdate).getTime() <= new Date().getTime())) || (dubAiring?.airdate && (new Date(dubAiring.airdate).getTime() <= new Date().getTime()))} />
                      </div>
                    {/if}
                  </div>
                {/if}
                {#if hasFiller}
                  <div class='position-absolute bottom-0 right-0 bg-secondary py-5 px-10 text-dark rounded-top rounded-left font-weight-bold'>
                    {filler?.filler ? 'Filler' : 'Recap'}
                  </div>
                {/if}
                <div class='h-full w-full px-20 pt-15 d-flex flex-column'>
                  <div class='w-full d-flex flex-row mb-15'>
                    <div class='text-white font-weight-bold font-size-16 overflow-hidden title'>
                      {#if resolvedTitle && !resolvedTitle.includes(episode)}{episode}. {/if}{resolvedTitle || 'Episode ' + episode}
                    </div>
                    {#if length}
                      <div class='ml-auto pl-5'>
                        {length}m
                      </div>
                    {/if}
                  </div>
                  {#if completed}
                    <div class='progress mb-15' style='height: .2rem; min-height: .2rem;'>
                      <div class='progress-bar w-full'/>
                    </div>
                  {:else if progress}
                    <div class='progress mb-15' style='height: .2rem; min-height: .2rem;'>
                      <div class='progress-bar' style='width: {progress}%'/>
                    </div>
                  {/if}
                  <div class='font-size-12 overflow-hidden line-4' class:summary={unreleased} class:font-weight-bold={unreleased}>
                    {summary || ''}
                  </div>
                  <div class='font-size-12 mt-auto' class:pt-10={dubAiring} class:pt-15={!dubAiring} class:mb-5={dubAiring} class:mb-10={!dubAiring}>
                    {#if dubAiring}
                      <div class='d-flex flex-row date-row'>
                        <div class='mr-5 py-5 px-10 text-dark text-nowrap rounded-top rounded-left font-weight-bold' class:lg-label={image} class:bg-danger={dubAiring.delayed} class:bg-dubbed={!dubAiring.delayed}>
                          Dub: {dubAiring.text}
                        </div>
                        {#if airdate || dubAiring.delayed}
                          <div class='py-5 px-10 text-dark text-nowrap rounded-top rounded-left font-weight-bold' class:lg-label={image} class:bg-danger={!airdate && dubAiring.delayed} class:bg-subbed={!(!airdate && dubAiring.delayed)}>
                            Sub: {airdate ? since(new Date(airdate)) : dubAiring.text}
                          </div>
                        {/if}
                      </div>
                    {:else}
                      {#if airdate}
                        {since(new Date(airdate))}
                      {:else if media.status === 'RELEASING' && episode > 1}
                        In Production
                      {/if}
                    {/if}
                    {#if airdate && dubAiring && (new Date(airdate).getTime() > new Date().getTime())}
                      <span class='d-none' class:sm-label={image}>{since(new Date(airdate))}</span>
                    {/if}
                  </div>
                </div>
              </div>
            </div>
          {/await}
        {/if}
      {/each}
    {/if}
  {/await}
</div>

<style>
  .unreleased {
    filter: blur(.06rem) grayscale(50%);
  }
  .unreleased:hover, .unreleased:focus {
    filter: blur(0) grayscale(20%);
  }
  .unreleased .summary {
    color: var(--accent-color)
  }
  .unreleased-overlay {
    background: repeating-linear-gradient(-45deg, rgba(0,0,0,0.3), rgba(0,0,0,0.3) 1rem, transparent 1rem, transparent 2rem);
  }
  .opacity-half {
    opacity: 50%;
  }
  .title {
    display: -webkit-box !important;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
    word-break: break-all;
  }
  .scale {
    transition: opacity .2s ease-in-out, transform .2s ease-in-out, padding .1s ease-in-out;
  }
  .scale:hover, .scale:focus {
    transform: scale(1.035);
  }
  .scale-target:hover, .scale-target:focus {
    transform: scale(1.015) !important;
  }
  .border {
    --dm-border-color: white;
  }
  @media (max-width: 310px), (min-width: 993px) and (max-width: 1300px) {
    .lg-label {
      display: none !important;
    }
    .sm-label {
      display: inline !important;
    }
  }
  @media (max-width: 525px) {
    .flex-xsm-column {
      flex-direction: column !important;
    }
    .scale {
      height: auto !important;
    }
    .date-row {
      justify-content: center !important;
    }
    img {
      width: 100%;
      height: 15rem !important;
    }
  }

  @media (min-width: 1920px) {
    .scale:hover, .scale:focus {
      transform: scale(1.04);
    }
    .scale-target:hover, .scale-target:focus {
      transform: scale(1.02) !important;
    }
  }
  @media (min-width: 2400px) {
    .scale:hover, .scale:focus {
      transform: scale(1.03);
    }
    .scale-target:hover, .scale-target:focus {
      transform: scale(1.015) !important;
    }
  }
  @media (min-width: 3360px) {
    .scale:hover, .scale:focus {
      transform: scale(1.02);
    }
    .scale-target:hover, .scale-target:focus {
      transform: scale(1.01) !important;
    }
  }
  @media (min-width: 4800px) {
    .scale:hover, .scale:focus {
      transform: scale(1.01);
    }
    .scale-target:hover, .scale-target:focus {
      transform: scale(1.005) !important;
    }
  }
</style>
