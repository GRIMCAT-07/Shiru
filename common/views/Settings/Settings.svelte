<script context='module'>
  import { settings } from '@/modules/settings.js'
  import { capitalize } from '@/modules/util.js'
  import IPC from '@/modules/ipc.js'
  import Debug from 'debug'
  const debug = Debug('ui:settings-view')

  if (settings.value.enableDoH) IPC.emit('doh', settings.value.doHURL)
  export const platformMap = {
    aix: 'Aix',
    darwin: 'MacOS',
    android: 'Android',
    ios: 'iOS',
    freebsd: 'Linux',
    linux: 'Linux',
    openbsd: 'Linux',
    sunos: 'SunOS',
    win32: 'Windows'
  }
  let version = '1.0.0'
  IPC.on('version', data => {
    version = data
    debug(`v${version} ${platformMap[window.version.platform] || 'dev'} ${window.version.arch || 'dev'} ${capitalize(window.version.session) || ''}`, JSON.stringify(settings))
  })
  IPC.emit('version')
  IPC.emit('discord-rpc', settings.value.enableRPC)

  let changeLog = getChanges()
  window.addEventListener('online', () => changeLog = getChanges())
  async function getChanges() {
    try {
      const json = await (await fetch('https://api.github.com/repos/RockinChaos/Shiru/releases')).json()
      return json.map(({body, tag_name: version, published_at: date, assets}) => ({body, version, date, assets}))
    } catch (error) {
      debug('Failed to changelog', error)
      return {}
    }
  }
</script>

<script>
  import { Tabs, TabLabel, Tab } from '@/components/Tabination.js'
  import { onDestroy } from 'svelte'
  import PlayerSettings from '@/views/Settings/PlayerSettings.svelte'
  import TorrentSettings from '@/views/Settings/TorrentSettings.svelte'
  import InterfaceSettings from '@/views/Settings/InterfaceSettings.svelte'
  import AppSettings from '@/views/Settings/AppSettings.svelte'
  import ChangelogSk from '@/components/skeletons/ChangelogSk.svelte'
  import ExtensionSettings from '@/views/Settings/ExtensionSettings.svelte'
  import { profileView } from '@/components/Profiles.svelte'
  import { SUPPORTS } from '@/modules/support.js'
  import Helper from '@/modules/helper.js'
  import { AppWindow, Puzzle, User, Heart, LogIn, Logs, Play, Rss, LayoutDashboard } from 'lucide-svelte'

  export let playPage = false
  const safeTop = !SUPPORTS.isAndroid ? '18px' : '0px'

  const groups = {
    player: {
      name: 'Player',
      icon: Play
    },
    torrent: {
      name: 'Torrent',
      icon: Rss
    },
    interface: {
      name: 'Interface',
      icon: AppWindow
    },
    extensions: {
      name: 'Extensions',
      icon: Puzzle
    },
    app: {
      name: 'App',
      icon: LayoutDashboard
    },
    changelog: {
      name: 'Changelog',
      icon: Logs
    },
    login: {
      name: 'Login',
      user: Helper.getUser() && Helper.getUserAvatar(),
      userName: 'Profiles',
      icon: LogIn,
      action: () => ($profileView = true),
    },
    donate: {
      name: 'Donate',
      icon: Heart,
      action: () => IPC.emit('open', 'https://github.com/sponsors/RockinChaos/'),
      sidebar: true
    }
  }
  function pathListener (data) {
    $settings.torrentPathNew = data
  }

  function playerListener (data) {
    $settings.playerPath = data
  }

  function markdownToHtml(text) {
    const cleaned = text.replace(/<[^>]+>.*?<\/[^>]+>/gs, '').replace(/<[^>]+>/gs, '').replace(/(## Preview:|# Preview:)/g, '').trim()
    let htmlOutput = ''
    let listStack = []
    let inList = false
    let lastLevel = 0

    const closeList = (level) => {
      while (level < lastLevel && listStack.length > 0) {
        htmlOutput += listStack.pop()
        lastLevel--
      }
    }

    const openList = (level) => {
      while (level > lastLevel) {
        htmlOutput += '<ul>'
        listStack.push('</ul>')
        lastLevel++
      }
    }

    cleaned.split('\n').forEach(line => {
      if (!line.trim()) return
      const match = line.match(/^(\s*)([-*])\s+(.*)/)
      if (match) {
        const [, spaces, , content] = match
        const level = Math.floor(spaces.length / 2)
        closeList(level)
        openList(level)
        if (!inList) {
          htmlOutput += '<ul>'
          listStack.push('</ul>')
          inList = true
          lastLevel = 0
        }
        htmlOutput += `<li>${content.trim()}</li>`
      }
      else {
        closeList(0)
        if (inList) {
          htmlOutput += listStack.pop()
          inList = false
          lastLevel = 0
        }
        htmlOutput += `<p>${line.trim()}</p>`
      }
    })
    closeList(0)
    if (inList) htmlOutput += listStack.pop()
    return htmlOutput
  }

  onDestroy(() => {
    IPC.off('path', pathListener)
    IPC.off('player', playerListener)
  })
  $: IPC.emit('discord-rpc', $settings.enableRPC)
  IPC.on('path', pathListener)
  IPC.on('player', playerListener)
</script>

<Tabs>
  <div class='d-flex w-full h-full position-relative settings root flex-md-row flex-column' style='padding-top: max(var(--safe-area-top), {safeTop})'>
    <div class='d-flex flex-column h-lg-full bg-dark position-absolute position-lg-relative bb-10 w-full w-lg-300 z-10 flex-lg-shrink-0'>
      <div class='px-20 py-15 font-size-24 font-weight-semi-bold position-absolute d-none d-lg-block' style='margin-top: calc(-1 * max(var(--safe-area-top), {safeTop}))'>Settings</div>
      <div class='mt-lg-15 py-10 d-flex flex-lg-column flex-row justify-content-center justify-content-lg-start align-items-center align-items-lg-start'>
        {#each Object.values(groups) as group}
          <TabLabel name={group.user ? group.userName : group.name} action={group.action} sidebar={group.sidebar} let:active>
            {#if group.user}
              <span class='flex-shrink-0 p-5 m-5 rounded d-flex align-items-center'><img src={Helper.getUserAvatar()} class='h-30 w-30 rounded' alt='logo' /></span>
              <div class='font-size-16 line-height-normal d-none d-sm-block mr-10 text-truncate' style='color: {active ? `currentColor` : `#5e6061`}'>{group.userName}</div>
            {:else}
              <svelte:component this={group.icon} size='3.6rem' stroke-width='2.5' class='flex-shrink-0 p-5 m-5 rounded' color={active ? 'currentColor' : '#5e6061'} fill={group.icon === Play ? (active ? 'currentColor' : '#5e6061') : 'transparent'} />
              <div class='font-size-16 line-height-normal d-none d-sm-block mr-10 text-truncate' style='color: {active ? `currentColor` : `#5e6061`}'>{group.name}</div>
            {/if}
          </TabLabel>
        {/each}
      </div>
      <div class='d-none d-lg-block mt-auto'>
        <p class='text-muted px-20 py-10 m-0'>Restart may be required for some settings to take effect.</p>
        <p class='text-muted px-20 pb-10 m-0'>If you don't know what settings do what, use defaults.</p>
        <p class='text-muted px-20 m-0 mb-lg-20'>{version ? `v${version}` : ``} {platformMap[window.version.platform] || 'dev'} {window.version.arch || 'dev'} {capitalize(window.version.session) || ''}</p>
      </div>
    </div>
    <div class='mt-75 mt-lg-0 w-full overflow-y-auto overflow-y-md-hidden'>
      <div class='shadow-overlay d-lg-none' />
      <Tab>
        <div class='root h-full w-full overflow-y-md-auto p-20 pt-5'>
          <PlayerSettings bind:settings={$settings} bind:playPage />
          <div class='pb-10 d-md-none'/>
        </div>
      </Tab>
      <Tab>
        <div class='root h-full w-full overflow-y-md-auto p-20 pt-5'>
          <TorrentSettings bind:settings={$settings} />
          <div class='pb-10 d-md-none'/>
        </div>
      </Tab>
      <Tab>
        <div class='root h-full w-full overflow-y-md-auto p-20 pt-5'>
          <InterfaceSettings bind:settings={$settings} />
          <div class='pb-10 d-md-none'/>
        </div>
      </Tab>
      <Tab>
        <div class='root h-full w-full overflow-y-md-auto p-20 pt-5'>
          <ExtensionSettings bind:settings={$settings} />
          <div class='pb-10 d-md-none'/>
        </div>
      </Tab>
      <Tab>
        <div class='root h-full w-full overflow-y-md-auto p-20 pt-5'>
          <AppSettings {version} bind:settings={$settings} />
          <div class='pb-10 d-md-none'/>
        </div>
      </Tab>
      <Tab>
        <div class='root h-full w-full overflow-y-md-auto p-20 pt-5'>
          <div class='column px-20 px-sm-0'>
            <h1 class='font-weight-bold text-white font-scale-40'>Changelog</h1>
            <div class='font-size-18 text-muted'>New updates and improvements to Shiru.</div>
            <div class='font-size-14 text-muted'>Your current App Version is <b>v{version}</b></div>
          </div>
          {#await changeLog}
            {#each Array(5) as _}
              <ChangelogSk />
            {/each}
          {:then changelog}
            {#each changelog.slice(0, 5) as { version, date, body }}
              <hr class='my-20' />
              <div class='row py-20 px-20 px-sm-0 position-relative text-wrap text-break'>
                <div class='col-sm-3 order-first text-white mb-10 mb-sm-0'>
                  <div class='position-sticky top-0 pt-20'>
                    {new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                </div>
                <div class='col-sm-9 pre-wrap text-muted'>
                  <h2 class='mt-0 font-weight-bold text-white font-scale-34'>{version}</h2>
                  <div class='ml-10'>{@html markdownToHtml(body)}</div>
                </div>
              </div>
            {/each}
          {:catch e}
            {#each Array(5) as _}
              <ChangelogSk />
            {/each}
          {/await}
        </div>
      </Tab>
    </div>
  </div>
</Tabs>

<style>
  .mt-75 {
    margin-top: 7.5rem;
  }
  .settings :global(select.form-control:invalid) {
    color: var(--dm-input-placeholder-text-color);
  }
  .settings :global(input:not(:focus):invalid) {
    box-shadow: 0 0 0 0.2rem var(--danger-color) !important;
  }
  .shadow-overlay {
    position: absolute;
    left: 0;
    right: 0;
    height: 1.2rem;
    box-shadow: 0 1.2rem 1.2rem #131416;
    pointer-events: none;
    margin-top: -1.6rem;
    z-index: 1;
  }
  .bb-10 {
    border-bottom: .10rem rgba(182, 182, 182, 0.13) solid !important;
  }
</style>