<script>
  import { persisted } from 'svelte-persisted-store'
  import { getContext } from 'svelte'
  import { click } from '@/modules/click.js'
  import { SUPPORTS } from '@/modules/support.js'
  import IPC from '@/modules/ipc.js'

  export let page
  const view = getContext('view')
  function close () {
    $view = null
    page = 'home'
  }

  const debug = persisted('debug', '', {
    serializer: {
      parse: e => e,
      stringify: e => e
    }
  })

  $: maximized = false
  IPC.on('isMaximized', (isMaximized) => maximized = isMaximized)
</script>

<div class='w-full z-101 navbar bg-transparent border-0 p-0 d-flex draggable'>
    {#if window.version?.platform !== 'darwin'}
      <div class='window-controls d-flex position-absolute top-0 right-0 h-full'>
        <button class='button max-button d-flex border-0 color-white align-items-center justify-content-center' on:click={() => IPC.emit('minimize')}><svg class='svg-controls' height='12' role='img' viewBox='0 0 12 12' width='12'><rect fill='currentColor' height='1' width='10' x='1' y='6' /></svg></button>
        <button class='button restore-button d-flex border-0 color-white align-items-center justify-content-center' on:click={async () => IPC.emit('maximize')}>
          {#if maximized}
            <svg class='svg-controls' height='12' role='img' viewBox='0 0 12 12' width='12'>
              <rect fill='none' height='7' stroke='currentColor' width='7' x='3.5' y='1.1' />
              <rect fill='none' height='7' stroke='currentColor' width='7' x='1.5' y='3.5' />
            </svg>
          {:else}
            <svg class='svg-controls' height='12' role='img' viewBox='0 0 12 12' width='12'>
              <rect fill='none' height='9' stroke='currentColor' width='9' x='1.5' y='1.5' />
            </svg>
          {/if}
        </button>
        <button class='button close-button d-flex border-0 color-white align-items-center justify-content-center' on:click={() => IPC.emit('close-prompt')}><svg class='svg-controls' height='12' role='img' viewBox='0 0 12 12' width='12'><polygon fill='currentColor' fill-rule='evenodd' points='11 1.576 6.583 6 11 10.424 10.424 11 6 6.583 1.576 11 1 10.424 5.417 6 1 1.576 1.576 1 6 5.417 10.424 1' /></svg></button>
      </div>
    {/if}
</div>
<div class='position-absolute' class:right-0={SUPPORTS.isAndroid}>
  <img src='./logo_filled.png' class='z-102 position-absolute w-50 h-50 m-10 pointer d-none p-5' class:d-md-block={!SUPPORTS.isAndroid} class:mt-20={window.version?.platform === 'darwin'} alt='ico' use:click={close} />
  {#if $debug}
    <div class='z-100 ribbon text-center position-absolute font-size-16 font-weight-bold pointer-events-none {!SUPPORTS.isAndroid ? `ribbon-left` : `ribbon-right`}'>Debug Mode</div>
  {/if}
</div>

<style>
  .ribbon {
    background: var(--accent-color);
    box-shadow: 0 0 0 10rem var(--accent-color);
    clip-path: inset(0 -100%);
    opacity: 0.6;
  }
  .ribbon-left {
    min-width: 16rem;
    inset: 0 auto auto 0;
    transform-origin: 100% 0;
    transform: translate(-29.3%) rotate(-45deg);
  }
  .ribbon-right {
    min-width: 19rem;
    inset: 0 0 auto auto;
    transform-origin: 0 0;
    transform: translate(29.3%) rotate(45deg);
  }
  .navbar {
    --navbar-height: 32px !important;
  }
  .draggable {
    -webkit-app-region: drag;
    color: var(--dm-text-muted-color);
    font-size: 11.2px;
    width: calc(env(titlebar-area-width, 100%) - 1px);
  }
  img {
    top: 0;
    -webkit-app-region: no-drag
  }
  svg {
    width: 18px;
    height: 18px;
    width: 100%;
  }
  .navbar {
    left: unset !important;
  }
  @media (pointer: none), (pointer: coarse) {
    .navbar {
      display: none !important;
      height: 0;
    }
  }
  .window-controls {
    -webkit-app-region: no-drag;
    backdrop-filter: blur(8px);
    background: rgba(24, 24, 24, 0.1);
  }
  .window-controls .button {
    background: transparent;
    width: 46px;
    height: 32px;
    user-select: none;
  }
  .window-controls .button:hover {
    background: rgba(128, 128, 128, 0.2);
  }
  .window-controls .button:active {
    background: rgba(128, 128, 128, 0.4);
  }
  .close-button:hover {
    background: #e81123 !important;
  }
  .close-button:active {
    background: #f1707a !important;
  }
  .svg-controls {
    width: 12px;
    height: 12px;
  }
</style>