<script context='module'>
  import { findInCurrent } from '@/views/Player/MediaHandler.svelte'
  import { writable } from 'simple-store-svelte'

  export const rss = writable(null)

  export function playAnime (media, episode = 1, force) {
    episode = Number(episode)
    episode = isNaN(episode) ? 1 : episode
    if (!force && findInCurrent({ media, episode })) {
      window.dispatchEvent(new Event('overlay-check'))
      window.dispatchEvent(new Event('player'))
      return
    }
    rss.set({ media, episode })
  }
</script>

<script>
  import TorrentMenu from '@/views/TorrentSearch/TorrentMenu.svelte'

  export let overlay

  function close () {
    if (overlay.includes('torrent')) overlay = overlay.filter(item => item !== 'torrent')
    $rss = null
  }
  function checkClose ({ keyCode }) {
    if (keyCode === 27) close()
  }

  let modal

  $: search = $rss

  $: {
    if (search) {
      if (!overlay.includes('torrent')) overlay = [...overlay, 'torrent']
      modal?.focus()
    }
  }

  window.addEventListener('overlay-check', () => {
    if (search) {
      close()
    }
  })
</script>

<div class='modal-soft position-absolute d-flex align-items-center justify-content-center z-50 w-full h-full' class:hide={!search} class:show={search} id='viewAnime'>
  <div class='modal-soft-dialog d-flex align-items-center justify-content-center px-20 pt-30 mt-sm-20' class:hide={!search} class:show={search} on:pointerup|self={close} on:keydown={checkClose} tabindex='-1' role='button' bind:this={modal}>
    <div class='m-0 w-full wm-1150 h-full rounded overflow-hidden bg-very-dark d-flex flex-column overflow-y-scroll pt-0 px-0'>
      {#if search}
        <TorrentMenu {search} {close} />
      {/if}
    </div>
  </div>
</div>

<style>
  .pt-30 {
    padding-top: 3rem
  }
  .modal-soft {
    background-color: rgba(0,0,0,0.85);
    transition: opacity .1s ease-in-out, visibility .1s ease-in-out;
  }
  .modal-soft.show {
    visibility: visible;
    opacity: 1;
  }
  .modal-soft.hide {
    visibility: hidden;
    opacity: 0;
  }

  .modal-soft-dialog {
    width: 100%;
    height: 100%;
    transition: transform .1s ease-in-out;
    transform-origin: bottom center;
  }
  .modal-soft-dialog.show {
    transform: scale(1);
  }
  .modal-soft-dialog.hide {
    transform: scale(0.95);
  }

  .wm-1150 {
    max-width: 115rem;
  }
</style>
