<script>
  import { getContext } from 'svelte'
  import { rss } from '@/views/TorrentSearch/TorrentModal.svelte'
  import { nowPlaying as media } from '@/views/Player/MediaHandler.svelte'
  import { profileView } from '@/components/Profiles.svelte'
  import { notifyView, hasUnreadNotifications } from '@/components/Notifications.svelte'
  import { actionPrompt } from '@/components/MinimizeTray.svelte'
  import { settings } from '@/modules/settings.js'
  import { SUPPORTS } from '@/modules/support.js'
  import { status } from '@/modules/networking.js'
  import { toast } from 'svelte-sonner'
  import Helper from '@/modules/helper.js'
  import IPC from '@/modules/ipc.js'
  import SidebarLink from '@/components/SidebarLink.svelte'
  import { CalendarSearch, Download, Heart, Home, Search, ListVideo, History, TvMinimalPlay, LogIn, Settings, Users, Bell, BellDot } from 'lucide-svelte'

  let updateState = ''

  IPC.on('update-available', () => {
    updateState = 'downloading'
  })
  IPC.on('update-downloaded', () => {
    updateState = 'ready'
  })

  const view = getContext('view')
  const btnSize = !SUPPORTS.isAndroid ? '3.1rem' : '3.6rem'

  export let page
  export let playPage

  let _status = status.value
  $: statusTransition = false
  $: {
    if (_status !== $status) {
      statusTransition = true
      setTimeout(() => (statusTransition = false), 3000)
      _status = $status
    }
  }
</script>

<div class='sidebar z-30 d-md-block' class:animated={$settings.expandingSidebar}>
  <div class='position-absolute bg-dark traffic-lights' class:br-10={!$settings.expandingSidebar} class:d-none={window.version?.platform !== 'darwin'}/>
  <div class='sidebar-overlay z--1 pointer-events-none h-full position-absolute' />
  <div class='sidebar-menu h-full d-flex flex-column m-0 pb-5 animate' class:br-10={!$settings.expandingSidebar}>
    <div class='w-50 m-10 p-5 mb-0 top-0 flex-shrink-0 pointer-events-none {_status === `offline` ? `h-80` : `h-50`}' class:status-transition={statusTransition} class:d-none={SUPPORTS.isAndroid}/>
    <SidebarLink click={() => { page = 'home'; if ($view) $view = null }} _page='home' text='Home' css='{!SUPPORTS.isAndroid ? `mt-auto` : ``}' {page} overlay={($view || $profileView || $notifyView || $actionPrompt || $rss) && 'active'} let:active>
      <Home size={btnSize} class='flex-shrink-0 p-5 m-5 rounded' strokeWidth='2.5' color={active ? 'currentColor' : '#5e6061'} />
    </SidebarLink>
    <SidebarLink click={() => { page = 'search'; if ($view) $view = null }} _page='search' icon='search' text='Search' {page} overlay={($view || $profileView || $notifyView || $actionPrompt || $rss) && 'active'} let:active>
      <Search size={btnSize} class='flex-shrink-0 p-5 m-5 rounded' stroke-width='2.5' stroke='currentColor' color={active ? 'currentColor' : '#5e6061'} />
    </SidebarLink>
    <SidebarLink click={() => { page = 'schedule' }} _page='schedule' icon='schedule' text='Schedule' {page} overlay={($view || $profileView || $notifyView || $actionPrompt || $rss) && 'active'} let:active>
      <CalendarSearch size={btnSize} class='flex-shrink-0 p-5 m-5 rounded' strokeWidth='2.5' color={active ? 'currentColor' : '#5e6061'} />
    </SidebarLink>
    {#if $media?.media}
      {@const currentMedia = $view}
      {@const active = $view && !$notifyView && !$profileView && !$actionPrompt && 'active'}
      {@const wasOverlay = ($view || $profileView || $notifyView || $actionPrompt || $rss)}
      <SidebarLink click={() => {
        if (playPage && (page === 'player') && !wasOverlay) {
          playPage = false
        }
        if (playPage) {
          page = 'player'
        } else {
          $view = (currentMedia?.id === $media?.media.id && active ? null : $media?.media)
        }
      }} rbClick={() => { $view = (currentMedia?.id === $media?.media.id && active ? null : $media?.media) }} _page={playPage ? 'player' : ''} icon='queue_music' text={$media?.display ? 'Last Watched' : 'Now Playing'} {page} overlay={active} nowPlaying={!playPage && ($view?.id === $media?.media?.id)} let:active>
        <svelte:component this={playPage ? TvMinimalPlay : $media?.display ? History : ListVideo} size={btnSize} class='flex-shrink-0 p-5 m-5 rounded' strokeWidth='2.5' color={active ? 'currentColor' : '#5e6061'} />
      </SidebarLink>
    {/if}
    <SidebarLink click={() => { page = 'watchtogether' }} _page='watchtogether' icon='groups' text='Watch Together' {page} overlay={($view || $profileView || $notifyView || $actionPrompt || $rss) && 'active'} let:active>
      <Users size={btnSize} class='flex-shrink-0 p-5 m-5 rounded' strokeWidth='2.5' color={active ? 'currentColor' : '#5e6061'} />
    </SidebarLink>
    {#if $settings.donate && !SUPPORTS.isAndroid}
      <SidebarLink click={() => { IPC.emit('open', 'https://github.com/sponsors/RockinChaos/') }} icon='favorite' text='Support This App' css='{!SUPPORTS.isAndroid ? `mt-auto` : ``}' {page} let:active>
        <Heart size={btnSize} class='flex-shrink-0 p-5 m-5 rounded donate' strokeWidth='2.5' fill='currentColor' />
      </SidebarLink>
    {/if}
    {#if updateState === 'downloading'}
      <SidebarLink click={() => { toast('Update is downloading...', { description: 'This may take a moment, the update will be ready shortly.' }) }} icon='download' text='Update Downloading...' css='{!$settings.donate && !SUPPORTS.isAndroid ? `mt-auto` : ``}' {page} let:active>
        <Download size={btnSize} class='flex-shrink-0 p-5 m-5 rounded' strokeWidth='2.5' color='#4a90e2' />
      </SidebarLink>
    {:else if updateState === 'ready'}
      <SidebarLink click={() => { IPC.emit('quit-and-install') }} icon='download' text='Update Ready!' css='{!$settings.donate && !SUPPORTS.isAndroid ? `mt-auto` : ``}' {page} let:active>
        <Download size={btnSize} class='flex-shrink-0 p-5 m-5 rounded update' strokeWidth='2.5' color='currentColor' />
      </SidebarLink>
    {/if}
    <SidebarLink click={() => { $notifyView = !$notifyView }} icon='bell' text='Notifications' css='{!$settings.donate && !SUPPORTS.isAndroid && updateState !== `downloading` && updateState !== `ready` ? `mt-auto` : ``}' {page} overlay={!$actionPrompt && $notifyView && 'notify'} nowPlaying={$view} let:active>
      {#if $hasUnreadNotifications && $hasUnreadNotifications > 0}
        <BellDot size={btnSize} class='flex-shrink-0 p-5 m-5 rounded notify {$notifyView ? `` : `notify-color`}' strokeWidth='2.5' color='currentColor' />
      {:else}
        <Bell size={btnSize} class='flex-shrink-0 p-5 m-5 rounded' strokeWidth='2.5' color={active ? 'currentColor' : '#5e6061'} />
      {/if}
    </SidebarLink>
    <SidebarLink click={() => { page = 'settings' }} _page='settings' icon='settings' text='Settings' {page} overlay={($view || $profileView || $notifyView || $actionPrompt || $rss) && 'active'} let:active>
      <Settings size={btnSize} class='flex-shrink-0 p-5 m-5 rounded' strokeWidth='2.5' color={active ? 'currentColor' : '#5e6061'} />
    </SidebarLink>
    {#if !SUPPORTS.isAndroid}
      <SidebarLink click={() => { $profileView = !$profileView }} icon='login' text={Helper.getUser() ? 'Profiles' : 'Login'} {page} overlay={!$notifyView && !$actionPrompt && $profileView && 'profile'} nowPlaying={$view} image={Helper.getUserAvatar()}>
        <LogIn size={btnSize} class='flex-shrink-0 p-5 m-5 rounded' />
      </SidebarLink>
    {/if}
  </div>
</div>

<style>
  .traffic-lights {
    width: 10rem;
    height: 3.5rem;
    border-bottom-right-radius: 4rem;
  }
  .sidebar .animate :global(.donate) {
    animation: pink_glow 1s ease-in-out infinite alternate;
    will-change: drop-shadow;
  }
  .sidebar .animate :global(.notify) {
    animation: purple_glow 1s ease-in-out infinite alternate, bell_shake 10s infinite;
    will-change: drop-shadow;
  }
  :global(.update) {
    color: #47cb6a;
    font-variation-settings: 'FILL' 1;
  }
  .sidebar :global(.donate):hover {
    color: #fa68b6 !important;
  }
  .sidebar :global(.donate) {
    font-variation-settings: 'FILL' 1;
    color: #fa68b6;
    text-shadow: 0 0 1rem #fa68b6;
  }
  @keyframes pink_glow {
    from {
      filter: drop-shadow(0 0 1rem #fa68b6);
    }
    to {
      filter: drop-shadow(0 0 0.5rem #fa68b6);
    }
  }
  .sidebar :global(.notify):hover {
    color: var(--dark-color) !important;
  }
  .sidebar :global(.notify-color) {
    color: #af68fa;
  }
  @keyframes purple_glow {
    from {
      filter: drop-shadow(0 0 2rem #af68fa);
    }
    to {
      filter: drop-shadow(0 0 0.2rem #af68fa);
    }
  }
  @keyframes bell_shake {
    0%, 7.5% {
      transform: rotate(0deg);
    }
    1.5% {
      transform: rotate(-15deg);
    }
    3% {
      transform: rotate(15deg);
    }
    4.5% {
      transform: rotate(-10deg);
    }
    6% {
      transform: rotate(10deg);
    }
  }
  .pt-100 {
    padding-top: 10rem;
  }

  .sidebar {
    transition: width .8s cubic-bezier(0.25, 0.8, 0.25, 1), left .8s cubic-bezier(0.25, 0.8, 0.25, 1) !important;
    background: none !important;
    overflow-y: unset;
    overflow-x: visible;
    left: unset;
  }
  .sidebar.animated:hover {
    width: 22rem
  }
  .sidebar.animated {
    z-index: 60 !important;
  }
  .sidebar-overlay {
    width: var(--sidebar-width);
    transition: width .8s cubic-bezier(0.25, 0.8, 0.25, 1), left .8s cubic-bezier(0.25, 0.8, 0.25, 1) !important;
    background: var(--sidebar-gradient);
    backdrop-filter: blur(2px);
  }
  .sidebar.animated:hover .sidebar-overlay {
    width: 63rem
  }
  .br-10 {
    border-right: .10rem rgba(182, 182, 182, 0.13) solid !important;
  }
</style>
