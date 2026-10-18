import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { GlassesApp } from './glasses/app'
import { showSyncEvent, startPhoneUi } from './phone/ui'
import { BookCache } from './store/books'
import { loadSettings, makeSettings, saveSettings, type KeyValue } from './store/settings'

const bridge = await waitForEvenAppBridge()

const kv: KeyValue = {
  get: key => bridge.getLocalStorage(key),
  set: (key, value) => bridge.setLocalStorage(key, value),
}

// Dev only: seed settings from VITE_DEV_SERVER_URL / _USER / _PASSWORD in
// .env.local, for the simulator where the phone page is awkward to type into.
// Stripped from production builds.
if (import.meta.env.DEV && import.meta.env.VITE_DEV_SERVER_URL && !(await loadSettings(kv))) {
  const env = import.meta.env
  await saveSettings(kv, makeSettings(env.VITE_DEV_SERVER_URL, env.VITE_DEV_SERVER_USER ?? '', env.VITE_DEV_SERVER_PASSWORD ?? ''))
}

const glasses = new GlassesApp(bridge, kv, new BookCache(), { onSync: showSyncEvent })
glasses.start()

await startPhoneUi(kv, {
  onSettingsSaved: () => void glasses.showLibrary(),
  onSendToGlasses: book => void glasses.openBook(book),
})
