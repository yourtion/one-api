<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { listTables } from '../api/index.js';

const status = ref<'loading' | 'ok' | 'down'>('loading');
const tableCount = ref(0);

onMounted(async () => {
  // healthz 挂在根路径（非 /api 前缀），直接用原生 fetch
  try {
    const r = await fetch('/healthz');
    status.value = r.ok ? 'ok' : 'down';
  } catch {
    status.value = 'down';
  }
  try {
    tableCount.value = (await listTables()).length;
  } catch {
    /* ignore */
  }
});
</script>

<template>
  <div class="page">
    <div class="page-header"><h1 class="page-title">系统设置</h1></div>
    <div class="card" style="padding: 24px; max-width: 640px">
      <el-descriptions :column="1" border>
        <el-descriptions-item label="服务状态">
          <el-tag v-if="status === 'ok'" type="success" size="small">运行中</el-tag>
          <el-tag v-else-if="status === 'down'" type="danger" size="small">异常</el-tag>
          <el-tag v-else type="info" size="small">检测中</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="已注册表数">{{ tableCount }}</el-descriptions-item>
        <el-descriptions-item label="业务库路径">由服务端配置（~/.one-api/business.db）</el-descriptions-item>
        <el-descriptions-item label="系统库路径">由服务端配置（~/.one-api/system.db）</el-descriptions-item>
        <el-descriptions-item label="端口">3000（默认，PORT 可覆盖）</el-descriptions-item>
      </el-descriptions>
    </div>
  </div>
</template>
