<script context='module'>
  import { derived, writable } from 'simple-store-svelte'
  import { click, hoverExit } from '@/modules/click.js'
  import { createListener, matchPhrase, matchKeys, debounce, since } from '@/modules/util.js'
  import { Search, MailCheck, MailOpen, Play, X } from 'lucide-svelte'
  import ErrorCard from '@/components/cards/ErrorCard.svelte'
  import SoftModal from '@/components/SoftModal.svelte'
  import IPC from '@/modules/ipc.js'
  import { cache, caches, mediaCache } from '@/modules/cache.js'
  import { SUPPORTS } from '@/modules/support.js'

  export const notifyView = writable(false)
  export const notifications = writable(cache.getEntry(caches.NOTIFICATIONS, 'notifications') || [])
  export const hasUnreadNotifications = derived(notifications, _notifications => _notifications?.filter(notification => notification.read !== true)?.length)

  let debounceNotify = false
  const debounceBatch = debounce(() => {
    if (debounceNotify) {
      cache.setEntry(caches.NOTIFICATIONS, 'notifications', notifications.value)
      setTimeout(() => IPC.emit('notification-unread', hasUnreadNotifications.value), 50)
      debounceNotify = false
    }
  }, 1500)
  notifications.subscribe(() => {
    debounceNotify = true
    debounceBatch()
  })
</script>
<script>
  export let overlay

  let modal
  const { reactive, init } = createListener(['btn'])
  function close () {
    $notifyView = false
    if (overlay.includes('notifications')) overlay = overlay.filter(item => item !== 'notifications')
    updateSort()
  }
  function checkClose ({ keyCode }) {
    if (keyCode === 27) close()
  }
  $: $notifyView && (modal?.focus(), setOverlay())
  $: !$notifyView && close()
  $: init($notifyView)
  $: {
    if (!$notifyView) updateSort()
    else currentNotifications = $notifications.slice(0, notificationCount)
  }
  function setOverlay() {
    if (!overlay.includes('notifications')) overlay = [...overlay, 'notifications']
  }

  window.addEventListener('overlay-check', () => { if ($notifyView) close() })
  window.addEventListener('notification-app', (event) => addNotification(event.detail))
  window.addEventListener('notification-read', (event) => markRead(event.detail))
  window.addEventListener('notification-reset', () => notifications.set([]))

  function addNotification(notification) {
    notifications.update((n) => {
      const filterDelayed = n.filter((existing) => { // Remove existing notifications based on delayed status and conditions
        if (notification.delayed) return !(existing.id === notification.id && existing.episode === notification.episode && existing.dub === true && existing.click_action === 'PLAY') // If the new notification is delayed, remove all matching notifications
        else return !(existing.id === notification.id && existing.episode === notification.episode && existing.delayed === true) // If the new notification is not delayed, remove any existing delayed notifications
      })

      if ((filterDelayed.findIndex((existing) => existing.id === notification.id && ((existing.episode === notification.episode && ((existing.season || 0) === (notification.season || 0))) || (existing.format === 'MOVIE' && notification.format === 'MOVIE')) && (existing.dub === notification.dub) && (existing.click_action === 'TORRENT'))) !== -1) return filterDelayed // Don't add notifications for an episode if a torrent notification already exists (prevents duplicate notifications)
      const filtered = filterDelayed.filter((existing) => (existing.id !== notification.id || existing.episode !== notification.episode || existing.dub !== notification.dub || existing.click_action === 'TORRENT'))
      if (notification.episode && (mediaCache.value[notification?.id]?.mediaListEntry?.status === 'COMPLETED' || (mediaCache.value[notification?.id]?.mediaListEntry?.progress >= (!notification.season ? notification.episode : mediaCache.value[notification?.id].episodes)))) notification.read = true
      return sort([notification, ...filtered])
    })
  }

  function sort(array) {
    return array.sort((a, b) => {
      const timestampDiff = b.timestamp - a.timestamp
      if (timestampDiff !== 0) return timestampDiff
      if (a.id === b.id && a.episode && b.episode && !a.season && !b.season) return b.episode - a.episode
      return 0
    }).sort((a, b) => {
      if (!a.read && b.read) return -1
      if (a.read && !b.read) return 1
      return 0
    })
  }

  function markAll(read) {
    notifications.update(items => items.map(notification => ({...notification, read: read })))
  }

  function markRead(media) {
    notifications.update((n) => {
      return n.map((existing) => {
        if (existing.id === media.id && ((media.episode >= existing.episode) || (existing.season && (media.episode >= mediaCache.value[media?.id]?.episodes)))) existing.read = true
        return existing
      })
    })
  }

  function onclick(notification, view) {
    close()
    if (notification.click_action === 'VIEW' || view) {
      window.dispatchEvent(new CustomEvent('open-anime', { detail: { id: notification.id } }))
    } else if (notification.click_action === 'PLAY') {
      window.dispatchEvent(new CustomEvent('play-anime', {
        detail: {
          id: notification.id,
          episode: notification.episode,
          torrentOnly: true
        }
      }))
    } else if (notification.click_action === 'TORRENT') {
      window.dispatchEvent(new CustomEvent('play-torrent', { detail: { magnet: notification.magnet } }))
    }
  }

  function updateSort() {
    notifications.update(notifications => sort([...notifications]))
    return true
  }

  let container
  let searchText = ''
  function filterResults(results, searchText) {
    if (!searchText?.length) return results
    return results.filter(({ id, title }) => matchPhrase(searchText, title, 0.4, false, true) || matchKeys($mediaCache[id], searchText, ['title.userPreferred', 'title.english', 'title.romaji', 'title.native', 'synonyms'], 0.4)) || []
  }

  let notificationCountDefault = 25
  let notificationCount = notificationCountDefault
  let currentNotifications = []
  function handleScroll(event) {
    const container = event.target
    if (currentNotifications.length !== $notifications.length && container.scrollTop + container.clientHeight + 10 >= container.scrollHeight) {
      const nextBatch = filterResults($notifications, searchText).slice(currentNotifications.length, currentNotifications.length + notificationCount)
      currentNotifications = [...new Set([...currentNotifications, ...nextBatch])]
    }
  }
  IPC.emit('notification-unread', hasUnreadNotifications.value)
</script>

<SoftModal class='m-0 w-800 mw-0 {$notifications?.length ? `h-full` : ``} d-flex flex-column rounded bg-very-dark pt-0 py-30 pl-20 pr-30 mx-20 scrollbar-none' bind:showModal={$notifyView} {close} id='notificationModal'>
  {#if $notifyView}
    <div class='d-flex mt-30'>
      <h3 class='mb-0 font-weight-bold text-white title mr-5 font-size-24 ml-20'>Notifications</h3>
      <button type='button' class='btn btn-square bg-dark ml-auto d-flex align-items-center justify-content-center rounded-2 flex-shrink-0' use:click={close}><X size='1.7rem' strokeWidth='3'/></button>
    </div>
    <div class='input-group mt-10 mx-20' class:d-none={!$notifications?.length}>
      <Search size='2.6rem' strokeWidth='2.5' class='position-absolute z-10 text-dark-light h-full pl-10 pointer-events-none' />
      <input
        type='search'
        class='form-control bg-dark-light pl-40 rounded-1 h-40 text-truncate mr-50'
        autocomplete='off'
        data-option='search'
        placeholder='Filter notifications by their titles' bind:value={searchText} on:input={(event) => { container.scrollTo({top: 0}); notificationCount = notificationCountDefault; currentNotifications = filterResults($notifications, event.target.value).slice(0, notificationCount) }} />
    </div>
    <div class='shadow-overlay' />
    {#if $notifications?.length && !currentNotifications?.length}
      <ErrorCard promise={{ errors: [ { message: 'found no results' }]}}/>
    {/if}
    <div bind:this={container} class='notification-list mt-10 overflow-y-auto' class:h-full={$notifications?.length} class:mh-350={currentNotifications.length > 0} on:scroll={handleScroll}>
      {#each currentNotifications as notification, index}
        {@const delayed = notification.delayed}
        {@const announcement = notification.click_action === 'VIEW' && !delayed}
        {@const notWatching = !announcement && !delayed && ((!$mediaCache[notification?.id]?.mediaListEntry?.progress) || ($mediaCache[notification?.id]?.mediaListEntry?.progress === 0 && ($mediaCache[notification?.id]?.mediaListEntry?.status !== 'CURRENT' || $mediaCache[notification?.id]?.mediaListEntry?.status !== 'REPEATING' && $mediaCache[notification?.id]?.mediaListEntry?.status !== 'COMPLETED')))}
        {@const behind = !announcement && !delayed && notification.episode && ($mediaCache[notification?.id]?.mediaListEntry?.status !== 'COMPLETED' && (($mediaCache[notification?.id]?.mediaListEntry?.progress || -1) < ((!notification.season ? notification.episode : $mediaCache[notification?.id].episodes) - 1)))}
        {@const watched = !announcement && !delayed && !notWatching && !behind && notification.episode && ($mediaCache[notification?.id]?.mediaListEntry?.status === 'COMPLETED' || ($mediaCache[notification?.id]?.mediaListEntry?.progress >= (!notification.season ? notification.episode : $mediaCache[notification?.id].episodes)))}
        {#if watched && !notification.read}{(notification.read = true) && updateSort() && ''}{/if}
        <div class='notification-item shadow-lg position-relative d-flex align-items-center mx-20 my-5 p-5 scale pointer' class:mt-20={index === 0} role='button' tabindex='0' use:hoverExit={() => { notification.prompt = false; delete notification.prompt }} use:click={() => { if (!behind || notification.prompt) { notification.prompt = false; delete notification.prompt; notification.read = true; onclick(notification) } else { notification.prompt = true } } } on:contextmenu|preventDefault={() => { notification.read = true; onclick(notification, true); }} class:not-reactive={!$reactive} class:read={notification.read} class:behind={(behind && !notWatching) || delayed} class:current={!behind && !notWatching} class:not-watching={notWatching} class:watched={watched} class:announcement={announcement}>
          {#if notification.heroImg}
            <div class='position-absolute top-0 left-0 w-full h-full'>
              <img src={notification.heroImg} alt='bannerImage' class='hero-img img-cover w-full h-full' />
              <div class='position-absolute top-0 left-0 w-full h-full rounded-5' style='background: var(--notification-card-gradient)' />
            </div>
          {/if}
          <div class='rounded-5 d-flex justify-content-center align-items-center overflow-hidden mr-10 z-10 notification-icon-container'>
            <img src={notification.icon || './404_cover.png'} alt='icon' class='notification-icon rounded-5 w-auto' />
          </div>
          <div class='notification-content z-10 w-full'>
            <p class='notification-title overflow-hidden font-weight-bold my-0 mr-40 font-scale-18 {SUPPORTS.isAndroid ? `line-clamp-1` : `line-clamp-2`}'>{notification.title}</p>
            <button type='button' class='position-absolute right-0 top-0 mr-5 mt-5 btn btn-square d-flex align-items-center justify-content-center' class:not-allowed={watched} class:not-reactive={watched} use:click={() => { if (!watched) notification.prompt = false; delete notification.prompt; notification.read = !notification.read } }>
              {#if notification.read}
                <MailOpen size='1.7rem' strokeWidth='3'/>
              {:else}
                <MailCheck size='1.7rem' strokeWidth='3'/>
              {/if}
            </button>
            <p class='font-size-12 my-0 mr-40'>{notification.message}</p>
            <div class='d-flex justify-content-between align-items-center mt-5'>
              <p class='font-size-10 text-muted my-0'>{since(new Date(notification.timestamp * 1000))}</p>
              <div>
                {#if announcement}
                  <span class='badge text-dark bg-announcement mr-5'>Announcement</span>
                {:else if notification.format === 'MOVIE'}
                  <span class='badge text-dark bg-episode mr-5'>Movie</span>
                {:else if !notification.season}
                  {#if delayed}<span class='badge text-dark bg-delayed mr-5'>Delayed</span>{/if}
                  <span class='badge text-dark bg-episode mr-5'>{notification.episode ? `Episode ${Array.isArray(notification.episode) ? `${notification.episode[0]} ~ ${notification.episode[1]}` : notification.episode}` : `Batch`} </span>
                {:else if notification.season}
                  <span class='badge text-dark bg-episode mr-5'>Season {notification.episode}</span>
                {/if}
                {#if notification.dub}
                  <span class='badge text-dark bg-dubbed'>Dub</span>
                {:else}
                  <span class='badge text-dark bg-subbed'>Sub</span>
                {/if}
              </div>
            </div>
          </div>
          <div class='overlay position-absolute w-full h-full z-40 d-flex flex-column align-items-center' class:visible={notification.prompt} class:invisible={!notification.prompt}>
            <p class='mx-20 font-size-20 text-white text-center mt-auto mb-0'>
              {#if !$mediaCache[notification?.id]?.mediaListEntry?.progress}
                You Haven't Watched Any Episodes Yet!
              {:else}
                Your Current Progress Is At <b>Episode {$mediaCache[notification?.id]?.mediaListEntry?.progress}</b>
              {/if}
            </p>
            <button type='button' class='btn btn-lg btn-secondary w-230 h-33 text-dark font-size-16 font-weight-bold shadow-none border-0 d-flex align-items-center mt-10 mb-auto' use:click={() => { notification.prompt = false; delete notification.prompt; notification.read = true; onclick(notification) } }>
              <Play class='mr-10' fill='currentColor' size='1.4rem' />
              Continue Anyway?
            </button>
          </div>
        </div>
      {/each}
    </div>
    <div class='d-flex flex-column justify-content-between align-items-center'>
      {#if $notifications?.length}
        <button type='button' class='btn text-light font-weight-bold shadow-none border-0 d-flex align-items-center mt-20' disabled={searchText?.length} on:click={() => markAll($hasUnreadNotifications && $hasUnreadNotifications > 0)}>
          {#if $hasUnreadNotifications && $hasUnreadNotifications > 0}
            <MailCheck strokeWidth='3' class='mr-10' size='1.7rem' />
            Mark All As Read
          {:else}
            <MailOpen strokeWidth='3' class='mr-10' size='1.7rem' />
            Mark All As Unread
          {/if}
        </button>
      {:else}
        <div class='w-800 mw-0'>
          <ErrorCard promise={{ errors: [ { message: ['Nothing To See Here!', 'Settings > Interface > Notifications Settings']}]}}/>
        </div>
      {/if}
    </div>
  {/if}
</SoftModal>

<style>
  .h-33 {
    height: 3.3rem !important;
  }
  .mr-40 {
    margin-right: 4rem !important;
  }
  .mr-50 {
    margin-right: 5rem;
  }
  .mh-350 {
    min-height: 35rem;
  }
  .scale {
    transition: transform 0.2s ease;
    will-change: transform;
  }
  .scale:hover{
    transform: scale(1.04);
  }
  .font-size-10 {
    font-size: 1rem;
  }

  .notification-item {
    background-color: rgb(26, 28, 32);
    border-radius: .75rem;
  }
  .notification-item.read {
    opacity: .5;
  }
  .notification-item.current {
    border-left: .4rem solid rgb(61,180,242);
  }
  .notification-item.watched {
    border-left: .4rem solid rgb(123,213,85);
  }
  .notification-item.behind {
    border-left: .4rem solid rgb(250,122,122);
  }
  .notification-item.announcement {
    border-left: .4rem solid #FFFFF0;
  }
  .notification-item.not-watching {
    border-left: .4rem solid #494747;
  }

  .notification-title {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    line-height: 1.2;
    text-overflow: ellipsis;
    word-wrap: break-word;
  }

  .line-clamp-1 {
    -webkit-line-clamp: 1;
  }
  .line-clamp-2 {
    -webkit-line-clamp: 2;
  }

  .hero-img {
    border-radius: .75rem;
  }
  .notification-icon {
    height: 100%;
    object-fit: cover;
    object-position: center;
  }
  .notification-icon-container {
    width: 6rem;
    height: 8rem;
  }
  .rounded-5 {
    border-radius: .5rem;
  }
  .shadow-overlay {
    position: absolute;
    left: 0;
    right: 0;
    height: 1.2rem;
    margin-top: 12rem;
    box-shadow: 0 1.2rem 1.2rem #131416;
    pointer-events: none;
    z-index: 1;
  }

  .overlay {
    margin-left: -.9rem !important;
    width: 100.6% !important;
    border-radius: .62rem;
    background-color: rgba(0, 0, 0, 0.8) !important;
  }
</style>