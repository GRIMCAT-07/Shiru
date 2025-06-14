<script>
  import { EllipsisVertical } from 'lucide-svelte'
  import { onDestroy, onMount } from 'svelte'
  import { fastPrettyBytes } from '@/modules/util.js'
  import { add, stage, untrack, complete } from '@/modules/torrent/torrent.js'
  import { click } from '@/modules/click.js'
  import { eta, createListener } from '@/modules/util.js'
  import AnimeResolver from '@/modules/animeresolver.js'
  export let data
  export let current = false
  export let completed = false

  function ratioType(ratio, progress) {
    if (((Math.ceil(ratio * 100) / 100).toFixed(2) <= 0 || progress < 1)) return 'Leeching'
    else if (ratio < 0.5) return 'Leecher'
    else if (ratio < 1.0) return 'Fair'
    else if (ratio < 2.5) return 'Acceptable'
    return 'Seeder'
  }

  function altClick() {
    if (completed) stage(data.infoHash, data.infoHash)
    else if (data.progress === 1) complete(data.infoHash)
  }

  let options
  function toggleDropdown () {
    options.classList.toggle('active')
    options.closest('.dropdown').classList.toggle('show')
  }

  const { reactive, init } = createListener([`react-${data.infoHash}`])
  const { reactive: _reactive, init: _init } = createListener([`react-${data.infoHash}`])
  onMount(() => {
    init(true, true)
    _init(true)
    reactive.subscribe(value => {
      if (!value && options) {
        const dropdown = options.closest('.dropdown')
        if (dropdown.classList.contains('show')) {
          options.classList.toggle('active')
          dropdown.classList.toggle('show')
        }
      }
    })
  })
  onDestroy(() => {
    init(false, true)
    _init(false)
  })
</script>
<div role='button' class='details border-top py-20 text-wrap text-break-word {$_reactive && !current ? `` : `not-reactive`}' class:bg-error={completed && data.incomplete} class:current={current} class:option={!current} class:pointer={!current} class:not-allowed={current} aria-label={!current ? 'Play Torrent' : 'Currently Playing'} title={!current ? 'Play Torrent' : 'Currently Playing'} use:click={() => { if (!current) add(data.infoHash, null, data.infoHash) }} on:contextmenu|preventDefault={altClick}>
  <div class='d-flex flex-row w-full load-in'>
    <div class='p-5 ml-20 name mw-150 flex-1 w-auto d-flex line-2' title={(data.name && AnimeResolver.cleanFileName(data.name)) || ''}>{(data.name && AnimeResolver.cleanFileName(data.name)) || '—'}</div>
    <div class='p-5 w-150 d-none d-md-block'>{fastPrettyBytes(data.size)}</div>
    <div class='p-5 w-150'>{data.size && !data.incomplete ? `${(completed && '100.0') || (data.progress * 100).toFixed(1)}%` : data.name && !data.incomplete ? '0.0%' : '—'}</div>
    <div class='p-5 w-150'>{completed ? (data.incomplete ? 'Incomplete' : 'Completed') : data.progress === 1 ? 'Seeding' : data.size && data.downloadSpeed ? 'Downloading' : data.name ? 'Stalled' : '—'}</div>
    <div class='p-5 w-150 d-none d-md-block'>{!completed && data.name && (data.progress ? ((Math.ceil((data.ratio || 0) * 100) / 100)?.toFixed(2)) : '0.00') || '—'}<span class='text-muted text-nowrap' class:d-none={completed || !data.name}>{` (${ratioType(data.ratio || 0, data.progress)})`}</span></div>
    <div class='p-5 w-150'>{completed ? '—' : `${fastPrettyBytes(data.downloadSpeed || 0)}/s`}</div>
    <div class='p-5 w-150 d-none d-md-block'>{completed ? '—' : `${fastPrettyBytes(data.uploadSpeed || 0)}/s`}</div>
    <div class='p-5 w-150'>{completed ? '—' : data.numSeeders || 0}<span class='text-muted text-nowrap' class:d-none={completed}>{` (${data.numPeers || 0})`}</span></div>
    <div class='p-5 w-150 d-none d-md-block'>{completed ? '—' : data.numLeechers || 0}<span class='text-muted text-nowrap' class:d-none={completed}>{` (${data.numPeers || 0})`}</span></div>
    <div class='p-5 w-115 d-none d-md-block'>{data.eta > 0 && data.progress < 1 && data.downloadSpeed ? eta(new Date(Date.now() + data.eta)) : '∞'}</div>
    <div class='dropdown react-{data.infoHash} with-arrow right-0 mr-5 mr-md-20 h-full w-40' class:invisible={current} use:click={toggleDropdown}>
      <span bind:this={options} class='btn btn-square h-full bg-transparent border-0 options d-flex align-items-center muted justify-content-center flex-shrink-0 h-full w-40' title='Options'><EllipsisVertical size='2rem' /></span>
      <div class='dropdown-menu dropdown-menu-right pt-5 pb-5 ml-10 text-capitalize hm-400 text-nowrap'>
        <div role='button' class='pointer d-none align-items-center justify-content-center font-size-16 rounded option details py-5' class:d-flex={!current} aria-label='Play Torrent' title='Play Torrent' use:click={() => { add(data.infoHash, null, data.infoHash); toggleDropdown() }}>
          Play
        </div>
        <div role='button' class='pointer d-none align-items-center justify-content-center font-size-16 rounded option details py-5' class:d-flex={!current} aria-label='Untrack Torrent' title='Untrack Torrent' use:click={() => { untrack(data.infoHash); toggleDropdown() }}>
          Untrack
        </div>
        <div role='button' class='pointer d-none align-items-center justify-content-center font-size-16 rounded option details py-5' class:d-flex={!completed && !current && data.progress === 1} aria-label='Stop Seeding' title='Stop Seeding' use:click={() => { complete(data.infoHash); toggleDropdown() }}>
          Stop Seeding
        </div>
        <div role='button' class='pointer d-none align-items-center justify-content-center font-size-16 rounded option details py-5' class:d-flex={completed} aria-label='Start Seeding' title='Start Seeding' use:click={() => { stage(data.infoHash, data.infoHash); toggleDropdown() }}>
          Start Seeding
        </div>
      </div>
    </div>
  </div>
</div>
<style>
  .current {
    border: .1rem solid var(--quaternary-color) !important;
  }
  .details {
    border: .1rem solid transparent;
  }
  .option:hover {
    background-color: var(--dark-color-light);
    border: .1rem solid var(--highlight-color) !important;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    max-height: 4.7rem;
    line-height: 2rem;
  }
</style>