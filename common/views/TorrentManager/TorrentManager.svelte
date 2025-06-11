<script context='module'>
  import { writable } from 'simple-store-svelte'
  import { click } from '@/modules/click.js'
  import { settings } from '@/modules/settings.js'
  import { client } from '@/modules/torrent/torrent.js'
  import TorrentDetails from '@/views/TorrentManager/TorrentDetails.svelte'
  import { RefreshCw, Package, Percent, Activity, Scale, Gauge, CloudDownload, CloudUpload, Sprout, Magnet, Timer } from 'lucide-svelte'
  export const loadedTorrent = writable({})
  export const stagingTorrents = writable([])
  export const seedingTorrents = writable([])
  export const completedTorrents = writable([])
  client.on('activity', ({ detail }) => {
    loadedTorrent.update(() => ({ ...detail.current }))
    stagingTorrents.update(() => Array.from(new Map(detail.staging.map(t => [t.infoHash, t])).values()))
    seedingTorrents.update(() => Array.from(new Map(detail.seeding.map(t => [t.infoHash, t])).values()))
  })
  client.on('completedStats', ({ detail }) => completedTorrents.update(torrents => [...Array.from(new Map(detail.map(t => [t.infoHash, t])).values()), ...torrents]))
  client.on('staging', ({ detail }) => completedTorrents.update(torrents => torrents.filter(t => t.infoHash !== detail)))
  client.on('completed', ({ detail }) => {
    completedTorrents.update(prev => {
      const map = new Map(prev.map(t => [t.infoHash, t]))
      map.set(detail.infoHash, detail)
      return Array.from(map.values())
    })
  })
  client.on('untrack',  ({ detail }) => {
    stagingTorrents.update(arr => arr.filter(t => t.infoHash !== detail))
    seedingTorrents.update(arr => arr.filter(t => t.infoHash !== detail))
    completedTorrents.update(arr => arr.filter(t => t.infoHash !== detail))
  })
</script>

<div class='bg-dark h-full w-full d-flex flex-wrap flex-row root align-content-start status-transition {$$restProps.class}' style={$$restProps.class ? 'padding-top: max(var(--safe-area-top), var(--safe-bar-top))' : ''}>
  <div class='d-flex align-items-center w-full'>
    <h4 class='mb-10 font-weight-bold {$$restProps.class ? `ml-20 mt-20` : ``}'>Manage Torrents</h4>
    <button type='button' use:click={() => client.send('rescan')} disabled={!settings.value.torrentPersist} title={!settings.value.torrentPersist ? 'Persist Files is disabled' : 'Rescan Cache'} class='btn btn-primary input-group-append d-flex align-items-center justify-content-center ml-auto mr-5 mr-md-20 font-scale-16'><RefreshCw class='mr-10' size='1.8rem' strokeWidth='2.5'/><span>Rescan</span></button>
  </div>
  <div class='d-flex flex-column w-full h-full text-wrap text-break-word font-scale-16 z-40'>
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
    <TorrentDetails bind:data={$loadedTorrent} current={true}/>
    {#each $stagingTorrents.slice().reverse() as torrent}
      <TorrentDetails data={torrent}/>
    {/each}
    {#each $seedingTorrents.slice().reverse() as torrent}
      <TorrentDetails data={torrent}/>
    {/each}
    {#each $completedTorrents.slice().reverse() as torrent}
      <TorrentDetails data={torrent} completed={true}/>
    {/each}
  </div>
</div>