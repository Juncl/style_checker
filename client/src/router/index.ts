import { createRouter, createWebHashHistory } from 'vue-router'
import ConsistencyView from '../views/consistency/ConsistencyView.vue'

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/consistency', component: ConsistencyView },
    { path: '/:pathMatch(.*)*', redirect: '/consistency' },
  ],
})

export default router
