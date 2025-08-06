<script context='module'>
  import SectionsManager, { sections } from '@/modules/sections.js'
  import { anilistClient, currentSeason, currentYear } from '@/modules/anilist.js'
  import { animeSchedule } from '@/modules/anime/animeschedule.js'
  import { settings } from '@/modules/settings.js'
  import { RSSManager } from '@/modules/rss.js'
  import Helper from '@/modules/helper.js'
  import { writable } from 'simple-store-svelte'

  const bannerData = writable(getTitles())
  // Refresh banner every 15 minutes
  setInterval(() => getTitles(true), 5 * 60 * 1000)

  async function getTitles(refresh) {
    const res = anilistClient.search({ method: 'Search', ...(settings.value.adult === 'hentai' && settings.value.hentaiBanner ? { genre: ['Hentai'] } : {}), sort: 'TRENDING_DESC', perPage: 50, onList: false, ...(settings.value.adult !== 'hentai' || !settings.value.hentaiBanner ? { season: currentSeason } : {}), year: currentYear, status_not: 'NOT_YET_RELEASED' })
    if (refresh) {
      const renderData = await res
      bannerData.set(Promise.resolve(renderData))
    }
    else return res
  }

  const manager = new SectionsManager()

  const mappedSections = {}

  for (const section of sections) {
    mappedSections[section.title] = section
  }

  for (const sectionTitle of settings.value.homeSections) manager.add(mappedSections[sectionTitle[0]])

  const continueWatching = 'Continue Watching'
  if (Helper.getUser()) {
    refreshSections(Helper.getClient().userLists, ['Dubbed Releases', 'Subbed Releases', 'Hentai Releases'], true)
    refreshSections(Helper.getClient().userLists, [continueWatching, 'Sequels You Missed', 'Stories You Missed', 'Planning List', 'Completed List', 'Paused List', 'Dropped List', 'Watching List'])
  }
  if (Helper.isMalAuth()) refreshSections(animeSchedule.subAiredLists, continueWatching) // When authorized with Anilist, this is already automatically handled.
  refreshSections(animeSchedule.dubAiredLists, continueWatching)
  function refreshSections(list, sections, schedule = false) {
    list.subscribe((value) => {
      if (!value) return
      for (const section of manager.sections) {
        // remove preview value, to force UI to re-request data, which updates it once in viewport
        if (sections.includes(section.title) && !section.hide && (!schedule || section.isSchedule)) section.preview.value = section.load(1, 50, section.variables)
      }
    })
  }

  // force update RSS feed when the user adjusts a series in the FileManager.
  window.addEventListener('fileEdit', () => {
    for (const section of manager.sections) {
      // remove preview value, to force UI to re-request data, which updates it once in viewport
      if (section.isRSS && !section.isSchedule) {
        const url = settings.value.rssFeedsNew.find(([feedTitle]) => feedTitle === section.title)?.[1]
        if (url) section.preview.value = RSSManager.getMediaForRSS(1, 12, url, false, true)
      }
    }
  })

  const isPreviousRSS = (i) => {
    let index = i - 1
    while (index >= 0) {
      if (!manager.sections[index]?.hide) return manager.sections[index]?.isRSS ?? false
      else if ((index - 1 >= 0) && manager.sections[index - 1]?.isRSS) return true
      index--
    }
    return false
  }
</script>

<script>
  import Section from '@/views/Home/Section.svelte'
  import Banner from '@/components/banner/Banner.svelte'
</script>

<div class='h-full w-full overflow-y-scroll root overflow-x-hidden'>
  <Banner data={$bannerData} />
  <div class='d-flex flex-column h-full w-full mt-15'>
    {#each manager.sections as section, i (i)}
      {#if !section.hide}
        <Section bind:opts={section} lastEpisode={isPreviousRSS(i)}/>
      {/if}
    {/each}
  </div>
</div>
