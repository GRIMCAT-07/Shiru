<script>
  import Home from '@/views/Home/Home.svelte'
  import MediaHandler, { nowPlaying as media } from '@/views/Player/MediaHandler.svelte'
  import Settings from '@/views/Settings/Settings.svelte'
  import WatchTogether from '@/views/WatchTogether/WatchTogether.svelte'
  import AiringSchedule from '@/views/AiringSchedule.svelte'
  import ViewTorrent from '@/views/TorrentManager/TorrentManager.svelte'
  import Miniplayer from '@/views/Player/Miniplayer.svelte'
  import Search from '@/views/Search.svelte'
  import { search, key } from '@/modules/sections.js'
  import { SUPPORTS } from '@/modules/support.js'
  import { status } from '@/modules/networking.js'

  export let page = 'home'
  export let overlay = []
  export let playPage = false

  $: document.documentElement.style.setProperty('--safe-bar-top', !SUPPORTS.isAndroid && $status !== 'offline' ? '18px' : '0px')
  $: visible = !overlay.includes('torrent') && !overlay.includes('notifications') && !overlay.includes('profiles') && !overlay.includes('minimizetray') && !overlay.includes('trailer') && !playPage && !$media?.display
</script>
<div class='w-full h-full position-absolute overflow-hidden' class:invisible={!($media && (Object.keys($media).length > 0)) || (playPage && overlay.includes('viewanime')) || (!visible && (page !== 'player'))}>
  <Miniplayer active={($media && (Object.keys($media).length > 0)) && ((page !== 'player' && visible) || (overlay.includes('viewanime') && visible))} class='bg-dark-light rounded-10 z-100 {(page === `player` && !overlay.includes(`viewanime`)) ? `h-full` : ``}' padding='2rem' bind:page>
    <MediaHandler miniplayer={page !== 'player' || overlay.includes('viewanime')} bind:page bind:overlay bind:playPage />
  </Miniplayer>
</div>
{#if page === 'settings'}
  <Settings bind:playPage bind:overlay />
{:else if page === 'home'}
  <Home />
{:else if page === 'search'}
  <Search search={search} key={key}/>
{:else if page === 'schedule'}
  <AiringSchedule />
{:else if page === 'watchtogether'}
  <WatchTogether />
{:else if page === 'torrents'}
  <ViewTorrent class='overflow-y-scroll'/>
{/if}
