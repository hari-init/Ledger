import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { router } from './router'
import { ensureSeedCategories } from './lib/db'
import { initCloudSync } from './lib/cloudSync'

ensureSeedCategories()
// installs auto-push hooks and pulls the latest if auto-sync is on
initCloudSync()

createApp(App).use(router).mount('#app')
