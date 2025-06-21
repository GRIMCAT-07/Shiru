<script context='module'>
  import { writable } from 'simple-store-svelte'
  import { click } from '@/modules/click.js'
  import { matchPhrase } from '@/modules/util.js'
  import { settings } from '@/modules/settings.js'
  import { client } from '@/modules/torrent/torrent.js'
  import ErrorCard from '@/components/cards/ErrorCard.svelte'
  import TorrentDetails from '@/views/TorrentManager/TorrentDetails.svelte'
  import { Search, RefreshCw, Package, Percent, Activity, Scale, Gauge, CloudDownload, CloudUpload, Sprout, Magnet, Timer } from 'lucide-svelte'
  export const loadedTorrent = writable({})
  export const stagingTorrents = writable([])
  export const seedingTorrents = writable([])
  export const completedTorrents = writable([])
  client.on('activity', ({ detail }) => {
    loadedTorrent.update(() => ({ ...detail.current }))
    stagingTorrents.update(() => Array.from(new Map(detail.staging.map(torrent => [torrent.infoHash, torrent])).values()))
    seedingTorrents.update(() => Array.from(new Map(detail.seeding.map(torrent => [torrent.infoHash, torrent])).values()))
  })
  client.on('completedStats', ({ detail }) => {
    completedTorrents.update(torrents => [...Array.from(new Map(detail.map(torrent => [torrent.infoHash, torrent])).values()), ...torrents])
  })
  client.on('staging', ({ detail }) => {
    const found = structuredClone(loadedTorrent.value?.infoHash === detail || seedingTorrents.value.find(torrent => torrent.infoHash === detail) || completedTorrents.value.find(torrent => torrent.infoHash === detail))
    if (loadedTorrent.value?.infoHash === detail) loadedTorrent.update(() => ({}))
    seedingTorrents.update(torrents => torrents.filter(torrent => torrent.infoHash !== detail))
    completedTorrents.update(torrents => torrents.filter(torrent => torrent.infoHash !== detail))
    if (found) (found.incomplete ? stagingTorrents : seedingTorrents).update(prev => [found, ...prev.filter(torrent => torrent.infoHash !== detail)])
  })
  client.on('completed', ({ detail }) => {
    if (loadedTorrent.value?.infoHash === detail.infoHash) loadedTorrent.update(() => ({}))
    stagingTorrents.update(arr => arr.filter(torrent => torrent.infoHash !== detail.infoHash))
    seedingTorrents.update(arr => arr.filter(torrent => torrent.infoHash !== detail.infoHash))
    completedTorrents.update(prev => [detail, ...prev.filter(torrent => torrent.infoHash !== detail.infoHash)])
  })
  client.on('untrack',  ({ detail }) => {
    stagingTorrents.update(arr => arr.filter(torrent => torrent.infoHash !== detail))
    seedingTorrents.update(arr => arr.filter(torrent => torrent.infoHash !== detail))
    completedTorrents.update(arr => arr.filter(torrent => torrent.infoHash !== detail))
  })
</script>
<script>
  let searchText = ''
  function filterResults(results, searchText) {
    if (!searchText?.length) return results
    return results.filter(({ name }) => matchPhrase(searchText, name, 0.4, false, true)) || []
  }
  $: filteredLoaded = matchPhrase(searchText, $loadedTorrent?.name, 0.4, false, true)
  $: filteredStaging = filterResults($stagingTorrents, searchText) || []
  $: filteredSeeding = filterResults($seedingTorrents, searchText) || []
  $: filteredCompleted = filterResults($completedTorrents, searchText) || []
  $: foundResults = !(searchText?.length && !filteredLoaded && !filteredStaging.length && !filteredSeeding.length && !filteredCompleted.length)
</script>

<div class='bg-dark h-full w-full root status-transition {$$restProps.class}' style={$$restProps.class ? 'padding-top: max(var(--safe-area-top), var(--safe-bar-top))' : ''}>
  <div class='w-full {$$restProps.class ? `ml-20 mt-20` : ``}'>
    <h4 class='font-weight-bold m-0 mb-10'>Manage Torrents</h4>
    <div class='d-flex align-items-center'>
      <div class='input-group wm-600'>
        <Search size='2.6rem' strokeWidth='2.5' class='position-absolute z-10 text-dark-light h-full pl-10 pointer-events-none' />
        <input
          type='search'
          class='form-control bg-dark-light pl-40 rounded-1 h-40 text-truncate'
          autocomplete='off'
          data-option='search'
          placeholder='Filter torrents by text, or manually specify one by pasting a magnet link or torrent file' bind:value={searchText} />
      </div>
      <button type='button' use:click={() => client.send('rescan')} disabled={!settings.value.torrentPersist} title={!settings.value.torrentPersist ? 'Persist Files is disabled' : 'Rescan Cache'} class='btn btn-primary d-flex align-items-center justify-content-center ml-20 mr-20 font-scale-16 h-full'><RefreshCw class='mr-10' size='1.8rem' strokeWidth='2.5'/><span>Rescan</span></button>
    </div>
  </div>
  <div class='d-flex flex-column w-full text-wrap text-break-word font-scale-16 mt-20'>
    <div class='d-flex flex-row mb-10 font-scale-18'>
      <div class='font-weight-bold p-5 ml-20 mw-150 flex-1 w-auto'>Name</div>
      <div class='font-weight-bold p-5 w-150 d-none d-md-block'><span class='d-none d-lg-block'>Size</span><Package class='d-lg-none' size='2rem'/></div>
      <div class='font-weight-bold p-5 w-150'><span class='d-none d-lg-block'>Progress</span><Percent class='d-lg-none' size='2rem'/></div>
      <div class='font-weight-bold p-5 w-150'><span class='d-none d-lg-block'>Status</span><Activity class='d-lg-none' size='2rem'/></div>
      <div class='font-weight-bold p-5 w-150 d-none d-md-block'><span class='d-none d-lg-block'>Ratio</span><Scale class='d-lg-none' size='2rem'/></div>
      <div class='font-weight-bold p-5 w-150 d-none d-md-block'><span class='d-none d-lg-block'>Down Speed</span><CloudDownload class='d-lg-none' size='2rem'/></div>
      <div class='font-weight-bold p-5 w-150 d-block d-md-none'><span class='d-none d-lg-block'>Speed</span><Gauge class='d-lg-none' size='2rem'/></div>
      <div class='font-weight-bold p-5 w-150 d-none d-md-block'><span class='d-none d-lg-block'>Up Speed</span><CloudUpload class='d-lg-none' size='2rem'/></div>
      <div class='font-weight-bold p-5 w-150'><span class='d-none d-lg-block'>Seeders</span><Sprout class='d-lg-none' size='2rem'/></div>
      <div class='font-weight-bold p-5 w-150 d-none d-md-block'><span class='d-none d-lg-block'>Leechers</span><Magnet class='d-lg-none' size='2rem'/></div>
      <div class='font-weight-bold p-5 w-115 d-none d-md-block'><span class='d-none d-lg-block'>ETA</span><Timer class='d-lg-none' size='2rem'/></div>
      <div class='font-weight-bold p-5 w-40 mr-5 mr-md-20 flex-shrink-0'/>
    </div>
    {#if foundResults}
      {#if !searchText?.length || filteredLoaded}
        <TorrentDetails bind:data={$loadedTorrent} current={true} />
      {/if}
      {#each filteredStaging as torrent}
        <TorrentDetails data={torrent}/>
      {/each}
      {#each filteredSeeding as torrent}
        <TorrentDetails data={torrent}/>
      {/each}
      {#each filteredCompleted as torrent}
        <TorrentDetails data={torrent} completed={true}/>
      {/each}
    {:else}
      <ErrorCard promise={{ errors: [ { message: 'found no results' }]}}/>
    {/if}
  </div>
</div>