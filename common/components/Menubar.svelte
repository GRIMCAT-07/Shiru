<script>
  import { persisted } from 'svelte-persisted-store'
  import { getContext } from 'svelte'
  import { click } from '@/modules/click.js'
  import { SUPPORTS } from '@/modules/support.js'
  import IPC from '@/modules/ipc.js'

  export let page
  const view = getContext('view')
  function home() {
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
  $: fullscreen = false
  IPC.on('isMaximized', (isMaximized) => maximized = isMaximized)
  IPC.on('isFullscreen', (isFullscreen) => fullscreen = isFullscreen)
</script>

<div class='w-full z-101 navbar bg-transparent border-0 p-0 d-flex draggable'>
  <div class='window-controls d-none position-absolute top-0 {window.version?.platform !== `darwin` ? `right-0 right-width` : `left-0 left-width`} h-full' class:d-flex={!SUPPORTS.isAndroid && !fullscreen || window.version?.platform !== 'darwin'}>
    {#if window.version?.platform !== 'win32' && window.version?.platform !== 'darwin'}
      <button class='button max-button d-flex border-0 color-white align-items-center justify-content-center' on:click={() => IPC.emit('minimize')}><svg class='svg-controls' height='12' role='img' viewBox='0 0 12 12' width='12'><rect fill='currentColor' height='1' width='10' x='1' y='6' /></svg></button>
      <button class='button restore-button d-flex border-0 color-white align-items-center justify-content-center' on:click={async () => IPC.emit('maximize')}>
        {#if maximized}
          <svg class='svg-controls' width='12' height='12' viewBox='0 0 12 12' fill='none' xmlns='http://www.w3.org/2000/svg'>
            <rect x='1' y='3' width='8' height='8' rx='.5' ry='.5' stroke='currentColor' stroke-width='1'/>
            <path d='M3 1H11V9' stroke='currentColor' stroke-width='1' stroke-linejoin='round'/>
          </svg>
        {:else}
          <svg class='svg-controls' height='12' role='img' viewBox='0 0 12 12' width='12'>
            <rect fill='none' height='9' stroke='currentColor' width='9' x='1.5' y='1.5' />
          </svg>
        {/if}
      </button>
      <button class='button close-button d-flex border-0 color-white align-items-center justify-content-center' on:click={() => IPC.emit('close-prompt')}><svg class='svg-controls' height='12' role='img' viewBox='0 0 12 12' width='12'><polygon fill='currentColor' fill-rule='evenodd' points='11 1.576 6.583 6 11 10.424 10.424 11 6 6.583 1.576 11 1 10.424 5.417 6 1 1.576 1.576 1 6 5.417 10.424 1' /></svg></button>
    {/if}
  </div>
</div>
<div class='position-absolute' class:right-0={SUPPORTS.isAndroid}>
  <img src='./icon_filled.png' tabindex='-1' class='z-102 position-absolute w-50 h-50 m-10 pointer d-none p-5 transition-mt {window.version?.platform === `darwin` ? fullscreen ? `mt-20` : `mt-30` : ``}' class:d-md-block={!SUPPORTS.isAndroid} alt='ico' use:click={home} />
  {#if $debug}
    <div class='z-100 ribbon text-center position-absolute font-size-16 font-weight-bold pointer-events-none {!SUPPORTS.isAndroid ? `ribbon-left` : `ribbon-right`}'>Debug Mode</div>
  {/if}
</div>

<style>
  .transition-mt {
    transition: margin-top 0.1s ease-in-out;
  }
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
    --navbar-height: 28px !important;
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
    background: rgba(24, 24, 24, 0.2);
  }
  .right-width {
    width: 137px;
  }
  .left-width {
    width: 67px;
    border-bottom-right-radius: var(--rounded-2-border-radius);
  }
  .window-controls .button {
    background: transparent;
    width: 46px;
    height: 28px;
    user-select: none;
  }
  @media (hover: hover) and (pointer: fine) {
    .window-controls .button:hover {
      background: rgba(128, 128, 128, 0.2);
    }
  }
  .window-controls .button:active {
    background: rgba(128, 128, 128, 0.4);
  }
  @media (hover: hover) and (pointer: fine) {
    .close-button:hover {
      background: var(--danger-color-dim) !important;
    }
  }
  .close-button:active {
    background: var(--danger-color-light) !important;
  }
  .svg-controls {
    width: 12px;
    height: 12px;
  }
</style>