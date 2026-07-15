import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { router } from './router'
import { ensureSeedCategories } from './lib/db'

ensureSeedCategories()

createApp(App).use(router).mount('#app')
