<script>
  import { Earth, WifiOff } from 'lucide-svelte'
  import { status } from '@/modules/networking.js'
  $: {
    const root = document.documentElement
    if ($status === 'offline') root.style.setProperty('--wrapper-offset', getComputedStyle(root).getPropertyValue('--statusbar-height').trim())
    else root.style.removeProperty('--wrapper-offset')
  }
</script>

<div class='overflow-hidden status-bar h-0' class:offline={$status === 'offline'}>
  <div class='z-101 position-absolute w-full d-flex align-items-center justify-content-center overflow-hidden status-bar h-0' class:offline={$status === 'offline'} class:bg-dark={$status === 'offline'} class:bg-success-subtle={$status !== 'offline'}>
    {#if $status === 'online'}
      <Earth size='1.8rem' strokeWidth='2.5' />
      <span class='ml-10 font-weight-semi-bold font-size-16'>Connection Restored</span>
    {:else if $status === 'offline'}
      <WifiOff size='1.8rem' strokeWidth='2.5' />
      <span class='ml-10 font-weight-semi-bold font-size-16'>Offline</span>
    {/if}
  </div>
</div>

<style>
  .status-bar {
    transition: height 0.3s ease;
    transition-delay: 2s;
  }
  .status-bar.offline {
    height: var(--statusbar-height);
  }
</style>