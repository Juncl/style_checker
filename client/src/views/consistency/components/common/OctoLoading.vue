<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 64 64"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
  >
    <circle cx="32"   cy="4"    r="4" fill="#D8D8D8" />
    <circle cx="51.8" cy="12.2" r="4" fill="#DFDFDF" />
    <circle cx="60"   cy="32"   r="4" fill="#D8D8D8" />
    <circle cx="51.8" cy="51.8" r="4" fill="#DFDFDF" />
    <circle cx="32"   cy="60"   r="4" fill="#F5EBE6" />
    <circle cx="12.2" cy="51.8" r="4" fill="#DFDFDF" />
    <circle cx="4"    cy="32"   r="4" fill="#F5EBE6" />
    <circle cx="12.2" cy="12.2" r="4" fill="#DFDFDF" />
    <path
      class="arc-spin"
      d="M 32 4 A 28 28 0 0 1 51.8 12.2"
      stroke="#0067D1"
      stroke-width="8"
      stroke-linecap="round"
    />
  </svg>
</template>

<script setup>
defineProps({
  size: { type: Number, default: 32 }
})
</script>

<style>
.arc-spin {
  animation: spin 1s linear infinite;
  transform-box: view-box;
  transform-origin: center;
}
</style>
