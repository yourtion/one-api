<script setup lang="ts">
defineProps<{ label: string; value: number | string; hint?: string }>();
</script>
<template>
  <div class="stat card">
    <div class="stat-label">{{ label }}</div>
    <div class="stat-value mono">{{ value }}</div>
    <div v-if="hint" class="stat-hint">{{ hint }}</div>
  </div>
</template>
<style scoped>
.stat {
  padding: 20px 22px;
}
.stat-label {
  color: var(--c-text-muted);
  font-size: 13px;
  font-weight: 600;
}
.stat-value {
  font-size: 34px;
  font-weight: 800;
  letter-spacing: -0.02em;
  margin-top: 6px;
  color: var(--c-primary-strong);
}
.stat-hint {
  color: var(--c-text-muted);
  font-size: 12px;
  margin-top: 4px;
}
</style>
