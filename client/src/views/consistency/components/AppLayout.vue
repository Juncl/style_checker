<template>
  <div class="app-layout">
    <!-- ── 顶部导航（iframe 模式下隐藏）── -->
    <header v-if="!isIframe" class="app-header">
      <img class="header-logo" :src="logoUrl" alt="Octo Designer" />
    </header>

    <div class="app-body">
      <slot></slot>
    </div>
  </div>
</template>

<script setup>
import logoUrl from '@/assets/logo.png'
import { inIframe } from '../../utils/tools.ts'
const isIframe = inIframe()
</script>
