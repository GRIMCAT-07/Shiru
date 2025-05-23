<script>
  import { SUPPORTS } from '@/modules/support.js'
  import { click } from '@/modules/click.js'
  import { onDestroy, onMount } from 'svelte'
  import ToggleTitle from '@/views/ViewAnime/ToggleTitle.svelte'
  import ToggleFooter from '@/views/ViewAnime/ToggleFooter.svelte'

  export let list = null

  $: showMore = !list
  function toggleList() {
    showMore = !showMore
  }

  export let title = 'Relations'
  export let promise = null

  let observer = null
  let container = null
  function updateRowMarkers() {
    const cards = Array.from(container.querySelectorAll('.small-card'))
    cards.forEach(card => card.classList.remove('first-in-row', 'last-in-row'))
    const rows = new Map()
    cards.forEach(card => {
      const top = Math.round(card.getBoundingClientRect().top)
      if (!rows.has(top)) rows.set(top, [])
      rows.get(top).push(card)
    })
    rows.forEach(cardsInRow => {
      if (cardsInRow.length > 0) {
        cardsInRow[0].classList.add('first-in-row')
        cardsInRow[cardsInRow.length - 1].classList.add('last-in-row')
      }
    })
  }

  if (!SUPPORTS.isAndroid) {
    onDestroy(() => {
      observer?.disconnect()
      window.removeEventListener('resize', updateRowMarkers)
    })
    onMount(() => {
      observer = new ResizeObserver(updateRowMarkers)
      observer.observe(container)
      window.addEventListener('resize', updateRowMarkers)
    })
  }
</script>
{#if list?.length}
  {@const canToggle = !SUPPORTS.isAndroid && list.length > 4}
    <span class='d-flex align-items-end mt-20' aria-hidden='true' class:pointer={canToggle} class:not-reactive={!(canToggle)} use:click={toggleList}>
      <ToggleTitle title={title} class={canToggle ? `more` : ``}></ToggleTitle>
    </span>
  <div class='pt-10 text-capitalize d-flex gallery'
       class:justify-content-center={list.length <= 2 || !SUPPORTS.isAndroid}
       class:justify-content-start={list.length > 2 && SUPPORTS.isAndroid}
       class:scroll={SUPPORTS.isAndroid && list.length > 2}
       class:flex-row={SUPPORTS.isAndroid}
       class:flex-wrap={!SUPPORTS.isAndroid}
       bind:this={container}>
    {#each SUPPORTS.isAndroid ? list : list.slice(0, showMore ? 100 : 4) as item}
      <slot {item} {promise} />
    {/each}
  </div>
  <ToggleFooter {showMore} {toggleList} size={!SUPPORTS.isAndroid && list.length} />
{/if}

<style>
  .scroll {
    overflow-x: scroll;
    flex-shrink: 0;
    scroll-behavior: smooth;
  }
  .scroll::-webkit-scrollbar {
    display: none;
  }

  .gallery :global(.first-in-row .small-card-ct  .absolute-container) {
    left: -48% !important;
  }
  .gallery :global(.last-in-row .small-card-ct .absolute-container) {
    right: -48% !important;
  }
  .gallery :global(.item.small-card) {
    width: 19rem !important;
  }
  .gallery :global(.small-card-ct) {
    height: 100% !important;
  }
</style>
