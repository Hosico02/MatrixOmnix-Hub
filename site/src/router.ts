import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'runs', component: () => import('./views/Runs.vue') },
    { path: '/runs/:id', name: 'run-detail', component: () => import('./views/RunDetail.vue') },
    { path: '/standards', name: 'standards', component: () => import('./views/Standards.vue') },
    { path: '/standards/:archetype', name: 'standard-detail',
      component: () => import('./views/StandardDetail.vue') },
    { path: '/iterate', name: 'iterate', component: () => import('./views/Iterate.vue') },
    { path: '/mentor', name: 'mentor', component: () => import('./views/Mentor.vue') },
    { path: '/proposals/:id', name: 'proposal-detail',
      component: () => import('./views/ProposalDetail.vue') },
  ],
});
