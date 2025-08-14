<script>
    export let images = []
    export let hidden = false

    let index = 0
    let resolvedImages = []
    $: filteredImages = images.filter(Boolean)
    $: loadNextImage(index, filteredImages)
    async function loadNextImage(index, filteredImages) {
        let image = filteredImages[index]
        try {
            if (typeof image === 'function') image = image()
            if (image && typeof image.then === 'function') image = await image
            if (Array.isArray(image)) {
                filteredImages.splice(index, 1, ...image.filter(Boolean))
                image = filteredImages[index]
            }
        } catch { image = '404.jpg' }
        resolvedImages[index] = image
    }
    function handleError() {
        if (index < filteredImages.length - 1) index += 1
        else hidden = true
    }
</script>
<img class={`${$$restProps.class}`} class:d-none={hidden} src={!hidden ? (resolvedImages[index] || '404.jpg') : '404.jpg'} alt='preview' draggable='false' loading='lazy' on:error={handleError} />