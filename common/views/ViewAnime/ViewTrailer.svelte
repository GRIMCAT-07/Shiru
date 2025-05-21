<script context='module'>
  import SoftModal from '@/components/SoftModal.svelte'
  import { writable } from 'simple-store-svelte'
  import { anilistClient } from '@/modules/anilist.js'
  import { click } from '@/modules/click.js'
  import { X } from 'lucide-svelte'
  export const trailer = writable()
</script>

<script>
  export let overlay

  $: hide = true
  function close () {
    if (overlay.includes('trailer')) overlay = overlay.filter(item => item !== 'trailer')
    $trailer = null
    hide = true
  }

  $: if ($trailer && !overlay.includes('trailer')) overlay = [...overlay, 'trailer']
  window.addEventListener('overlay-check', () => { if ($trailer) close() })
</script>

<SoftModal class='pointer-events-none w-full scrollbar-none align-items-center mb-30' bind:showModal={$trailer} {close} id='viewTrailer'>
  <div class='pointer-events-auto d-flex align-items-center rounded-top-5 w-full wm-calc bg-dark h-40'>
    <span class='title ml-20 font-weight-very-bold text-muted select-all mr-20 font-scale-18'>{anilistClient.title($trailer.media)}</span>
    <button type='button' class='btn btn-square bg-transparent shadow-none border-0 d-flex align-items-center justify-content-center ml-auto mr-5' use:click={close}><X size='1.7rem' strokeWidth='3'/></button>
  </div>
  <div class='pointer-events-auto ratio-16-9 position-relative w-full wm-calc'>
    <object class='ratio-16-9 img-cover w-full h-full rounded-bottom-6' data={`https://i.ytimg.com/vi/${$trailer.id}/hqdefault.jpg` || $trailer.media.bannerImage || $trailer.media.coverImage?.extraLarge || ' '} class:d-none={!hide}>
      <object class='ratio-16-9 img-cover w-full h-full rounded-bottom-6' data={$trailer.media.bannerImage || $trailer.media.coverImage?.extraLarge || ' '}>
        <img class='ratio-16-9 img-cover w-full h-full rounded-bottom-6' src={$trailer.media.coverImage?.extraLarge || ' '} alt='banner'> <!-- trailer no longer exists... fallback to cover image. -->
      </object>
    </object>
    <iframe
      class='position-absolute w-full h-full top-0 left-0 border-0 rounded-bottom-5'
      class:d-none={hide}
      title={$trailer.media.title.userPreferred}
      allow='autoplay'
      allowfullscreen
      on:load={() => { hide = false }}
      src={`https://www.youtube.com/embed/${$trailer.id}?autoplay=1&vq=hd720&cc_lang_pref=ja`}
    />
  </div>
</SoftModal>

<style>
  .rounded-top-5 {
    border-radius: .5rem .5rem 0 0;
  }
  .rounded-bottom-5 {
    border-radius: 0 0 .5rem .5rem;
  }
  .rounded-bottom-6 {
    border-radius: 0 0 .6rem .6rem;
  }
  .ratio-16-9 {
    aspect-ratio: 16/9;
  }
  .wm-calc {
    max-width: min(max(50vw, 100rem), calc(70vh * (16 / 9)));
  }
  .title {
    display: inline-block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
</style>