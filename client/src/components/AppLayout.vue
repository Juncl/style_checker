<template>
  <div class="app-layout">
    <!-- ── 顶部导航 ── -->
    <header class="app-header">
      <img class="header-logo" :src="logoUrl" alt="Octo Designer" />
    </header>

    <div class="app-body">
      <slot></slot>
    </div>
  </div>
</template>

<script setup>
import logoUrl from '../assets/logo.png'
</script>
