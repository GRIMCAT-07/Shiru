<script context='module'>
    import { mediaCache } from '@/modules/cache.js'
    import { click, hoverExit } from '@/modules/click.js'
    import { SquarePen, Play } from 'lucide-svelte'
    import { SUPPORTS } from '@/modules/support.js'
    import { createListener } from '@/modules/util.js'
    import { setHash } from '@/modules/anime/animehash.js'
    import { anilistClient } from '@/modules/anilist.js'
    import Debug from 'debug'

    const debug = Debug('ui:file-editor')
</script>
<script>
    export let file
    export let files
    export let playing = false
    export let noselect = false
    export let fileEdit
    export let playFile

    $: notWatching = ((!$mediaCache[file.media?.media?.id]?.mediaListEntry?.progress) || ($mediaCache[file.media?.media?.id]?.mediaListEntry?.progress === 0 && ($mediaCache[file.media?.media?.id]?.mediaListEntry?.status !== 'CURRENT' || $mediaCache[file.media?.media?.id]?.mediaListEntry?.status !== 'REPEATING' && $mediaCache[file.media?.media?.id]?.mediaListEntry?.status !== 'COMPLETED')))
    $: behind = file.media?.episode && !Array.isArray(file.media?.episode) && (file.media?.episode - 1) >= 1 && ($mediaCache[file.media?.media?.id]?.mediaListEntry?.status !== 'COMPLETED' && (($mediaCache[file.media?.media?.id]?.mediaListEntry?.progress || -1) < (file.media?.episode - 1)))
    $: watched = !notWatching && !behind && file.media?.episode && ($mediaCache[file.media?.media?.id]?.mediaListEntry?.status === 'COMPLETED' || ($mediaCache[file.media?.media?.id]?.mediaListEntry?.progress >= file.media?.episode))

    let prompt = false
    const { reactive, init } = createListener(['btn', 'input'])
    init(true)

    let editTimer = null
    let updateTimer = null
    $: episode = getEpisode()
    function getEpisode() {
        return (file.media.episodeRange && `${file.media.episodeRange.first}~${file.media.episodeRange.last}`) || (file.media.episode && (Array.isArray(file.media.episode) ? `${file.media.episode[0]}~${file.media.episode[1]}` : `${file.media.episode}`))
    }
    function updateEpisode(file, event) {
        clearTimeout(editTimer)
        clearTimeout(updateTimer)
        updateTimer = setTimeout(() => {
            const currentEpisode = file.media.episode
            const currentEpisodeRange = file.media.episodeRange
            let value = event.target.value.trim().replace(/\s+/g, '').replace(/-+/g, '~')
            if (value.includes('~')) {
                const parts = value.split('~').map(Number).filter(n => !isNaN(n))
                if (parts[1]) {
                    file.media.episodeRange = {
                        first: parts[0],
                        last: parts[1]
                    }
                }
                episode = getEpisode()
            } else {
                const num = Number(value)
                if (file.media.episodeRange) delete file.media.episodeRange
                file.media.episode = !isNaN(num) ? num : null
                episode = getEpisode()
            }
            if (file.media.episodeRange ? `${currentEpisodeRange.first}~${currentEpisodeRange.last}` !== episode : currentEpisode !== episode) {
                file.locked = true
                setHash(file.infoHash, {
                    fileHash: file.fileHash,
                    mediaId: file.media.media?.id,
                    episodeRange: file.media.episodeRange,
                    episode: file.media.episode || file.media.parseObject.episode_number,
                    season: file.media.season || file.media.parseObject.anime_season,
                    parseObject: file.media.parseObject,
                    locked: true,
                    failed: false
                })
            }
            debug(`Updated ${file.media?.media?.id} with Episode ${file.media.episode} and file:`, file)
            editTimer = setTimeout(() => window.dispatchEvent(new CustomEvent('fileEdit', { detail: { episode: true } })), 1500)
        }, 200)
    }
</script>

<div class='file-item shadow-lg position-relative d-flex align-items-center mx-20 my-5 p-5 scale {$$restProps.class}' class:playing={playing && !noselect} class:pointer={!playing} role='button' tabindex='0' title={file.name} use:hoverExit={() => { prompt = false } } use:click={() => { if (!behind || prompt) { prompt = false; if (!playing) { playFile(file) } } else if (!playing) { prompt = true } } } class:not-reactive={!$reactive || playing} class:behind={(behind && !notWatching)} class:current={!behind && !notWatching} class:not-watching={notWatching} class:watched={watched}>
    <div class='position-absolute top-0 left-0 w-full h-full'>
        <img src={file.media?.media?.bannerImage || ''} alt='bannerImage' class='hero-img img-cover w-full h-full' />
        <div class='position-absolute top-0 left-0 w-full h-full rounded-5' style='background: var(--notification-card-gradient)' />
    </div>
    <div class='rounded-5 d-flex justify-content-center align-items-center overflow-hidden mr-10 z-10 file-icon-container'>
        <img src={file.media?.media?.coverImage?.medium || file?.media?.media?.coverImage?.extraLarge || './404_cover.png'} alt='icon' class='file-icon rounded-5 w-auto' />
    </div>
    <div class='file-content z-10 w-full'>
        <div class='d-flex'>
            <p class='file-title overflow-hidden font-weight-bold my-0 mt-10 mr-10 font-scale-18 {SUPPORTS.isAndroid ? `line-clamp-1` : `line-clamp-2`}'>{#if file.media?.media}{anilistClient.title(file.media.media)}{:else}{file.media?.parseObject?.anime_title || file.name || 'UNK'}{/if}</p>
            <button type='button' class='ml-auto btn d-flex align-items-center justify-content-center' title='Opens a prompt to select the correct series' use:click={() => { prompt = false; fileEdit(file, files, file.media?.media ? anilistClient.title(file.media.media) : file.media?.parseObject?.anime_title || '') } }>
                <SquarePen class='mr-5' size='1.7rem' strokeWidth='3'/>
                <span>Change Series</span>
            </button>
        </div>
        <p class='font-scale-12 my-5 mr-40 text-muted text-break-word overflow-hidden line-2'>{file.name || 'UNK'}</p>
        <div class='d-flex align-items-center justify-content-center mt-5'>
            {#if playing}<span class='badge text-dark bg-announcement' title='The current file'>Now Playing</span>{/if}
            {#if file?.locked || file.media?.locked}<span class='badge text-dark bg-success-subtle' class:ml-5={playing} title='This series was manually set by the user'>Locked</span>{/if}
            {#if file?.failed || file.media?.failed}<span class='badge text-dark bg-danger-dim ml-auto h-27 mr-5 d-flex align-items-center justify-content-center' title='Failed to resolve the playing media based on the file name.'>Failed</span>{/if}
            {#if file.media?.media?.format === 'MOVIE'}
                <span class='badge text-dark bg-episode h-27 mr-5 d-flex align-items-center justify-content-center' class:ml-auto={!(file?.failed || file.media?.failed)}>Movie</span>
            {:else if episode}
                <span class='badge text-dark bg-episode mr-5 d-flex align-items-center justify-content-center' class:ml-auto={!(file?.failed || file.media?.failed)} title={`Episode {episode}`}>
                    <span class='mr-5'>Episode</span>
                    <input
                        type='text'
                        inputmode='text'
                        pattern='[0-9 ~\-]*'
                        bind:value={episode}
                        use:click|stopPropagation
                        on:input={(event) => {
                            const targetValue = event.target.value.replace(/[^0-9~\-]/g, '')
                            event.target.value = targetValue?.length ? targetValue : getEpisode()
                        }}
                        on:change={(event) => {
                            const targetValue = event.target.value.replace(/[^0-9~\-]/g, '')
                            episode = targetValue?.length ? targetValue : getEpisode()
                            updateEpisode(file, event)
                        }}
                        class='input form-control h-20 text-left text-dark text-truncate font-weight-semi-bold font-size-12 justify-content-center'
                        style='background-color: rgb(175,175,244) !important; width: calc(1.8rem + {(String(episode).length <= 10 ? String(episode).length : 10) * .7}rem) !important'
                        title='Episode Number(s)'/>
                </span>
            {/if}
        </div>
    </div>
    <div class='overlay position-absolute w-full h-full z-40 d-flex flex-column align-items-center' class:visible={prompt} class:invisible={!prompt}>
        <p class='mx-20 font-size-20 text-white text-center mt-auto mb-0'>
            {#if !$mediaCache[file.media?.media?.id]?.mediaListEntry?.progress}
                You Haven't Watched Any Episodes Yet!
            {:else}
                Your Current Progress Is At <b>Episode {$mediaCache[file.media?.media?.id]?.mediaListEntry?.progress}</b>
            {/if}
        </p>
        <button type='button' class='btn btn-lg btn-secondary w-230 h-33 text-dark font-size-16 font-weight-bold shadow-none border-0 d-flex align-items-center mt-10 mb-auto' use:click={() => { prompt = false; playFile(file) } }>
            <Play class='mr-10' fill='currentColor' size='1.4rem' />
            Continue Anyway?
        </button>
    </div>
</div>

<style>
    .h-27 {
        height: 2.7rem !important
    }
    .h-33 {
        height: 3.3rem !important;
    }
    .scale {
        transition: transform 0.2s ease;
        will-change: transform;
    }
    .scale:hover{
        transform: scale(1.025);
    }
    .playing {
        border: .2rem solid var(--tertiary-color);
    }
    .file-item {
        background-color: rgb(26, 28, 32);
        border-radius: .75rem;
    }
    .file-item.current {
        border-left: .4rem solid rgb(61,180,242);
    }
    .file-item.watched {
        border-left: .4rem solid rgb(123,213,85);
    }
    .file-item.behind {
        border-left: .4rem solid rgb(250,122,122);
    }
    .file-item.not-watching {
        border-left: .4rem solid #494747;
    }
    .file-title {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        text-overflow: ellipsis;
        word-wrap: break-word;
    }
    .line-clamp-1 {
        line-height: 1.4;
        -webkit-line-clamp: 1;
    }
    .line-clamp-2 {
        line-height: 1.2;
        -webkit-line-clamp: 2;
    }
    .hero-img {
        border-radius: .75rem;
    }
    .file-icon {
        height: 100%;
        object-fit: cover;
        object-position: center;
    }
    .file-icon-container {
        width: 6rem !important;
        height: 8rem !important;
    }
    .rounded-5 {
        border-radius: .5rem;
    }
    .overlay {
        margin-left: -.9rem !important;
        width: 100.6% !important;
        border-radius: .62rem;
        background-color: rgba(0, 0, 0, 0.8) !important;
    }
</style>