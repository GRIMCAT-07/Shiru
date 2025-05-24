<script>
  import { SUPPORTS } from '@/modules/support.js'
  import { click } from '@/modules/click.js'
  import { onDestroy, onMount, afterUpdate } from 'svelte'
  import ToggleTitle from '@/views/ViewAnime/ToggleTitle.svelte'
  import ToggleFooter from '@/views/ViewAnime/ToggleFooter.svelte'

  export let title
  export let promise
  export let list

  let showMore = false
  function toggleList() {
    showMore = !showMore
  }

  let container = null
  let previewLength = 4
  function updateRowLength() {
    if (!container || SUPPORTS.isAndroid) return
    const firstItem = container.querySelector('.small-card')
    if (firstItem) previewLength = Math.floor((container.offsetWidth) / (firstItem.offsetWidth)) || 1
  }

  function updateRowMarkers() {
    if (!container) return
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

  function handleResize() {
    updateRowLength()
    updateRowMarkers()
  }

  let observer = null
  afterUpdate(updateRowLength)
  onMount(() => {
    if (!SUPPORTS.isAndroid && container) {
      observer = new ResizeObserver(handleResize)
      observer.observe(container)
      window.addEventListener('resize', handleResize)
      updateRowLength()
    }
  })
  onDestroy(() => {
    if (!SUPPORTS.isAndroid) {
      observer?.disconnect()
      window.removeEventListener('resize', handleResize)
    }
  })
</script>

{#if list?.length}
  {@const canToggle = !SUPPORTS.isAndroid && list.length > previewLength}
  <span class='d-flex align-items-end mt-20' aria-hidden='true' class:pointer={canToggle} class:not-reactive={!canToggle} use:click={toggleList}>
    <ToggleTitle title={title} class={canToggle ? `more` : ``}/>
  </span>
  <div class='pt-10 text-capitalize d-flex gallery'
       class:justify-content-center={list.length <= 2 || !SUPPORTS.isAndroid}
       class:justify-content-start={list.length > 2 && SUPPORTS.isAndroid}
       class:scroll={SUPPORTS.isAndroid && list.length > 2}
       class:flex-row={SUPPORTS.isAndroid}
       class:flex-wrap={!SUPPORTS.isAndroid}
       bind:this={container}>
    {#each SUPPORTS.isAndroid ? list : (showMore ? list : list.slice(0, previewLength)) as item}
      <slot {item} {promise} />
    {/each}
  </div>
  <ToggleFooter {showMore} {toggleList} size={!SUPPORTS.isAndroid && list.length} rowSize={previewLength} />
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