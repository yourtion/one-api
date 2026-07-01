<script setup lang="ts">
defineProps<{ text?: string }>();
</script>
<template>
  <div class="empty">
    <el-icon :size="34" color="var(--c-text-muted)"><Files /></el-icon>
    <p>{{ text ?? '暂无数据' }}</p>
  </div>
</template>
<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 56px 0;
  color: var(--c-text-muted);
}
</style>
