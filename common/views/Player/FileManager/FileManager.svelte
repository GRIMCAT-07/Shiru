<script context='module'>
    import { writable } from 'simple-store-svelte'
    import { click } from '@/modules/click.js'
    import { Search, X } from 'lucide-svelte'
    import SoftModal from '@/components/SoftModal.svelte'
    import FileEditor from '@/views/Player/FileManager/FileEditor.svelte'
    import FileCard from '@/views/Player/FileManager/FileCard.svelte'
    export const managerView = writable(false)
</script>
<script>
    import { matchKeys, matchPhrase } from '@/modules/util.js'
    import { mediaCache } from '@/modules/cache.js'

    export let overlay

    function close () {
        $managerView = false
        if (overlay.includes('fileDetails')) overlay = overlay.filter(item => item !== 'fileDetails')
    }
    $: $managerView && setOverlay()
    $: !$managerView && close()
    function setOverlay() {
        if (!overlay.includes('fileDetails')) overlay = [...overlay, 'fileDetails']
    }

    export let playFile
    export let playing
    export let files

    let container
    let searchText = ''
    function filterResults(files, searchText) {
        if (!searchText?.length) return files
        return files.filter(({ name, media }) => matchPhrase(searchText, name, 0.4, false, true) || (media?.media?.id && matchKeys($mediaCache[media?.media?.id], searchText, ['title.userPreferred', 'title.english', 'title.romaji', 'title.native', 'synonyms'], 0.4))) || []
    }

    let fileEdit
    window.addEventListener('fileEdit', (event) => {
        if (event.detail?.episode) return
        if ($managerView) close()
        setTimeout(() => $managerView = true)
    })
    window.addEventListener('overlay-check', () => { if ($managerView) close() })
</script>

<SoftModal class='m-0 w-800 mw-0 mh-full d-flex flex-column rounded bg-very-dark pt-0 py-30 pl-20 pr-30 mx-20 scrollbar-none' bind:showModal={$managerView} {close} id='fileDetailModal'>
    <div class='d-flex mt-30 mb-10'>
        <h3 class='mb-0 font-weight-bold text-white title mr-5 font-size-24 ml-20'>File Manager</h3>
        <button type='button' class='btn btn-square bg-dark ml-auto d-flex align-items-center justify-content-center rounded-2 flex-shrink-0' use:click={close}><X size='1.7rem' strokeWidth='3'/></button>
    </div>
    <FileCard {playFile} bind:file={playing} bind:files playing={true} bind:fileEdit class='mr-30'/>
    <div class='input-group mt-10 mx-20' class:d-none={files?.length < 2}>
        <Search size='2.6rem' strokeWidth='2.5' class='position-absolute z-10 text-dark-light h-full pl-10 pointer-events-none' />
        <input
            type='search'
            class='form-control bg-dark-light pl-40 rounded-1 h-40 text-truncate mr-50'
            autocomplete='off'
            spellcheck='false'
            data-option='search'
            placeholder='Filter by file name or series title' bind:value={searchText} on:input={() => { container.scrollTo({top: 0}); }} />
    </div>
    <div class='shadow-overlay' class:d-none={files?.length < 2}/>
    <div bind:this={container} class='overflow-y-auto mt-10'>
        {#each filterResults(files?.filter((file) => file !== playing), searchText) as file, index}
            <FileCard {playFile} bind:file bind:files playing={file === playing} noselect={true} bind:fileEdit class='{index === 0 ? `mt-10` : ``}'/>
        {/each}
    </div>
</SoftModal>
<FileEditor bind:fileEdit bind:overlay />

<style>
    .shadow-overlay {
        position: absolute;
        left: 0;
        right: 0;
        height: 1.2rem;
        margin-top: 22.3rem;
        box-shadow: 0 1.2rem 1.2rem #131416;
        pointer-events: none;
        z-index: 1;
    }
</style>