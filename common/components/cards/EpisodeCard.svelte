<script context='module'>
  import AudioLabel from '@/views/ViewAnime/AudioLabel.svelte'
  import EpisodePreviewCard from '@/components/cards/EpisodePreviewCard.svelte'
  import { Play, RefreshCwOff } from 'lucide-svelte'
  import { onDestroy, onMount } from 'svelte'
  import { writable } from 'simple-store-svelte'
  import { getContext } from 'svelte'
  import { playActive } from '@/components/TorrentButton.svelte'
  import { createListener, since } from '@/modules/util.js'
  const { reactive, init } = createListener(['torrent-button', 'cont-button'])
  init(true)
</script>
<script>
  import { statusColorMap } from '@/modules/anime/anime.js'
  import { episodesList } from '@/modules/episodes.js'
  import { hoverClick, hoverExit } from '@/modules/click.js'
  import { liveAnimeEpisodeProgress } from '@/modules/anime/animeprogress.js'
  import { anilistClient } from '@/modules/anilist.js'
  import { settings } from '@/modules/settings.js'
  import { mediaCache } from '@/modules/cache.js'
  export let data
  export let section = false

  let preview = false
  let prompt = writable(false)
  let clicked = writable(false)

  /** @type {import('@/modules/al.d.ts').Media | null} */
  let media
  $: if (data.media && !media) {
    media = mediaCache.value[data.media.id]
  }
  mediaCache.subscribe((value) => { if (value && (JSON.stringify(value[media?.id]) !== JSON.stringify(media))) media = value[media?.id] })
  $: episodeThumbnail = ((!media?.mediaListEntry?.status || !(['CURRENT', 'REPEATING', 'PAUSED', 'PLANNING'].includes(media.mediaListEntry.status) && media.mediaListEntry.progress < data.episode)) && data.episodeData?.image) || media?.bannerImage || media?.coverImage.extraLarge || ' '
  let hide = true

  const view = getContext('view')
  function viewMedia () {
    $view = media
  }
  function setClickState() {
    if (!$prompt && data.episode && !Array.isArray(data.episode) && (data.episode - 1) >= 1 && media?.mediaListEntry?.status !== 'COMPLETED' && (media?.mediaListEntry?.progress || -1) < (data.episode - 1)) prompt.set(true)
    else data.episode ? (media ? playActive(data.hash, { media, episode: data.episode }, data.link) : data.onclick()) : viewMedia()
    clicked.set(true)
    setTimeout(() => clicked.set(false))
  }
  function setHoverState (state, tapped) {
    if (!$prompt && data.episode && !Array.isArray(data.episode) && (data.episode - 1) >= 1 && media?.mediaListEntry?.status !== 'COMPLETED' && (media?.mediaListEntry?.progress || -1) < (data.episode - 1)) prompt.set(!!tapped)
    if (!$prompt || !$clicked) preview = state
  }

  $: progress = liveAnimeEpisodeProgress(media?.id, data?.episode)
  $: watched = media?.mediaListEntry?.status === 'COMPLETED'
  $: completed = !watched && media?.mediaListEntry?.progress >= data?.episode

  let sinceInterval
  $: timeSince = data?.date && since(data?.date)
  onMount(() => sinceInterval = setInterval(() => timeSince = data?.date && since(data?.date), 60_000))
  onDestroy(() => clearInterval(sinceInterval))
</script>

<div class='d-flex p-20 pb-10 position-relative episode-card' class:mb-150={section} class:not-reactive={!$reactive} use:hoverExit={() => setTimeout(() => { if (!preview) prompt.set(false) })} use:hoverClick={[setClickState, setHoverState, viewMedia]} role='none'>
  {#if preview}
    <EpisodePreviewCard {data} bind:prompt={$prompt} />
  {/if}
  <div class='item load-in d-flex flex-column h-full pointer content-visibility-auto' class:opacity-half={completed}>
    <div class='image h-200 w-full position-relative rounded overflow-hidden d-flex justify-content-between align-items-end text-white' class:bg-black={episodeThumbnail === ' '}>
      <img loading='lazy' src={episodeThumbnail} alt='cover' class='cover-img w-full h-full position-absolute' class:cover-rotated={!(data.episodeData?.image || media?.bannerImage) && media?.genres?.includes('Hentai')} style:--color={media?.coverImage?.color || '#1890ff'} referrerpolicy='no-referrer' />
      {#if data.episodeData?.video}
        <video src={data.episodeData.video}
          class='w-full position-absolute left-0'
          class:d-none={hide}
          playsinline
          preload='metadata'
          muted
          on:loadeddata={() => { hide = false }} />
      {/if}
      {#if data.failed}
        <div class='pl-10 pt-10 z-10 position-absolute top-0 left-0 text-danger icon-shadow' title='Failed to resolve media'>
          <RefreshCwOff size='3rem' />
        </div>
      {/if}
      <Play class='mb-5 ml-5 pl-10 pb-10 z-10' fill='currentColor' size='3rem' />
      <div class='pr-15 pb-10 font-size-16 font-weight-medium z-10'>
        {#if media?.duration}
          {media.duration}m
        {/if}
      </div>
      {#if completed}
        <div class='progress container-fluid position-absolute z-10' style='height: 2px; min-height: 2px;'>
          <div class='progress-bar w-full' />
        </div>
      {:else if $progress > 0}
        <div class='progress container-fluid position-absolute z-10' style='height: 2px; min-height: 2px;'>
          <div class='progress-bar' style='width: {progress}%' />
        </div>
      {/if}
    </div>
    <div class='row pt-15'>
      <div class='col pr-10'>
        <div class='text-white font-weight-very-bold font-size-16 title overflow-hidden'>
          {#if media?.mediaListEntry?.status}
            <div style:--statusColor={statusColorMap[media.mediaListEntry.status]} class='list-status-circle d-inline-flex overflow-hidden mr-5' title={media.mediaListEntry.status} />
          {/if}
          {anilistClient.title(media) || data.parseObject?.anime_title}
        </div>
        <div class='text-muted font-size-12 title overflow-hidden'>
          {#if data.episodeData?.title?.en || data.episodeData?.title?.['x-jat'] || data.episodeData?.title?.ja || data.episodeData?.title?.jp}
            {data.episodeData?.title?.en || data.episodeData?.title?.['x-jat'] || data.episodeData?.title?.ja || data.episodeData?.title?.jp}
          {:else if (data.episode && !Array.isArray(data.episode))}
            {#await episodesList.getKitsuEpisodes(media?.id) then mappings}
              {@const kitsuMappings = data.episode && mappings?.data?.find(ep => ep?.attributes?.number === Number(data.episode) || data.episode)?.attributes}
              {kitsuMappings?.titles?.en_us || kitsuMappings?.titles?.en_jp || ''}
            {/await}
          {/if}
        </div>
      </div>
      <div class='col-auto d-flex flex-column align-items-end text-right mt-3'>
        <div class='text-white font-weight-bold'>
          {#if data.episode}
            {@const episodes = (Array.isArray(data.episode) && data.episode) || (data.parseObject?.file_name?.match(/\b\d+\s*[-~]\s*\d+\b/)?.[0]?.split(/[-~]/)?.map(n => +n.trim())) || (typeof data.episode === 'string' && data.episode.match(/^\d+\s*~\s*\d+$/) && data.episode.split(/~\s*/).map(n => +n.trim()))}
            {#if episodes?.length > 0 && ((Number(episodes[0]) || episodes[0]) < (Number(episodes[1]) || episodes[1]))}
              Episodes {Number(episodes[0]) || episodes[0]} ~ {Number(episodes[1]) || episodes[1]}
            {:else}
              Episode {Number(data.episode) || data.episode?.replace(/\D/g, '')}
            {/if}
          {:else if media?.format === 'MOVIE' }
            Movie
          {:else if data.parseObject?.anime_title?.match(/S(\d{2})/)}
            Season {parseInt(data.parseObject.anime_title.match(/S(\d{2})/)[1], 10)}
          {:else if (!data.episodeData?.video)}
            Batch
          {/if}
        </div>
        <div class='d-flex align-items-center'>
          <div class='text-nowrap font-size-12 title text-muted d-flex align-items-center'>
            <AudioLabel {media} {data} banner={true} episode={true} />
          </div>
          {#if data.date}
            {#if settings.value.cardAudio}
              <div class='text-muted font-size-12 title ml-5 mr-5 overflow-hidden'>
                •
              </div>
            {/if}
            <div class='text-muted font-size-12 title overflow-hidden'>
              {timeSince}
            </div>
          {:else if data.similarity}
            {#if settings.value.cardAudio}
              <div class='text-muted font-size-12 title ml-5 mr-5 overflow-hidden'>
                •
              </div>
            {/if}
            <div class='text-muted font-size-12 title overflow-hidden'>
              Confidence: {Math.round(data.similarity * 100)}%
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .icon-shadow {
    filter: drop-shadow(0 0 .4rem rgba(0, 0, 0, 1))
  }
  .episode-card:hover {
    z-index: 30 !important;
    /* fixes transform scaling on click causing z-index issues */
  }
  .mt-3 {
    margin-top: 0.3rem;
  }
  .mb-150 {
    margin-bottom: 15rem !important;
  }
  .opacity-half {
    opacity: 30%;
  }
  .title {
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
  }
  .image:after {
    background: var(--episode-card-gradient);
    content:'';
    position:absolute;
    left:0; top:0;
    width:100%; height:100%;
  }
  .item {
    width: 36rem;
    contain-intrinsic-height: 25.7rem;
  }
  .cover-img {
    background-color: var(--color) !important;
  }
  .cover-rotated {
    width: 20rem !important;
    height: 38rem !important;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-90deg);
  }
  .list-status-circle {
    background: var(--statusColor);
    height: 1.1rem;
    width: 1.1rem;
    border-radius: 50%;
  }
</style>