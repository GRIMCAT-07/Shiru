<script>
  import { SUPPORTS } from '@/modules/support.js'
  import { click } from '@/modules/click.js'
  import ToggleTitle from '@/views/ViewAnime/ToggleTitle.svelte'
  import ToggleFooter from '@/views/ViewAnime/ToggleFooter.svelte'

  export let list = null

  $: showMore = !list
  function toggleList() {
    showMore = !showMore
  }

  export let title = 'Relations'
  export let promise = null
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
       class:flex-wrap={!SUPPORTS.isAndroid}>
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
  .gallery :global(.small-card:first-child) :global(.absolute-container) {
    left: -48% !important;
  }
  .gallery :global(.small-card:last-child) :global(.absolute-container) {
    right: -48% !important;
  }
  .gallery :global(.item.small-card) {
    width: 19rem !important;
  }
  .gallery :global(.small-card-ct) {
    height: 100% !important;
  }
</style>
