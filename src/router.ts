import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: () => import('./views/DashboardView.vue') },
    {
      path: '/transactions',
      name: 'transactions',
      component: () => import('./views/TransactionsView.vue'),
    },
    { path: '/ask', name: 'ask', component: () => import('./views/AskView.vue') },
    { path: '/sync', name: 'sync', component: () => import('./views/SyncView.vue') },
    { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
