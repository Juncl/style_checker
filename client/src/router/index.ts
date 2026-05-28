import { createRouter, createWebHistory } from 'vue-router'
import ConsistencyView from '../views/consistency/ConsistencyView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/consistency', component: ConsistencyView },
    { path: '/:pathMatch(.*)*', redirect: '/consistency' },
  ],
})

export default router
