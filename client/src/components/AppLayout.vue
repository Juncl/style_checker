<template>
  <div class="app-layout">
    <!-- ── 顶部导航 ── -->
    <header class="app-header">
      <div class="header-left">
        <img class="header-logo" :src="logoUrl" alt="UX数字化平台 Octo Designer" />
      </div>
      <div class="header-actions">
        <slot name="header-actions"></slot>
      </div>
    </header>

    <div class="app-body">
      <slot></slot>
    </div>
  </div>
</template>

<script setup>
import logoUrl from '../assets/logo.png'
</script>
