import 'quartermoon/css/quartermoon-variables.css'
import '@fontsource-variable/nunito'
import { cacheReady } from '@/modules/cache.js'
import '@/css.css'
import '@/themes.css'
import '@/typography.css'

await cacheReady()
const { default: App } = await import('./App.svelte')
new App({ target: document.body })
