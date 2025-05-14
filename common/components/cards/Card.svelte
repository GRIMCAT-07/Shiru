<script>
  import SkeletonCard from '@/components/cards/SkeletonCard.svelte'
  import SmallCard from '@/components/cards/SmallCard.svelte'
  import EpisodeSkeletonCard from '@/components/cards/EpisodeSkeletonCard.svelte'
  import FullCard from '@/components/cards/FullCard.svelte'
  import EpisodeCard from '@/components/cards/EpisodeCard.svelte'
  import FullSkeletonCard from '@/components/cards/FullSkeletonCard.svelte'
  import { settings } from '@/modules/settings.js'

  export let card

  export let variables = null
  const type = card.type || $settings.cards
</script>

{#if type === 'episode'}

  {#await card.data}
    <EpisodeSkeletonCard section={variables?.section} />
  {:then data}
    {#if data}
      <EpisodeCard {data} section={variables?.section} />
    {/if}
  {/await}

{:else if type === 'full'}

  {#await card.data}
    <FullSkeletonCard />
  {:then data}
    {#if data}
      <FullCard {data} {variables} />
    {/if}
  {/await}

{:else} <!-- type === 'small'  -->

  {#await card.data}
    <SkeletonCard />
  {:then data}
    {#if data}
      <SmallCard {data} {variables} />
    {/if}
  {/await}

{/if}
