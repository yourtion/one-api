<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { listTables, listTokens, listAdmins } from '../api/index.js';
import type { TableMeta } from '@1api/shared';
import StatCard from '../components/StatCard.vue';

const router = useRouter();
const stats = ref({ tables: 0, tokens: 0, admins: 0 });
const recent = ref<TableMeta[]>([]);
const loading = ref(true);

onMounted(async () => {
  try {
    const [tables, tokens, admins] = await Promise.all([listTables(), listTokens(), listAdmins()]);
    stats.value = { tables: tables.length, tokens: tokens.length, admins: admins.length };
    recent.value = [...tables].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page" v-loading="loading">
    <div class="page-header"><h1 class="page-title">概览</h1></div>
    <div class="stats-grid">
      <StatCard label="已注册表" :value="stats.tables" />
      <StatCard label="Token 数" :value="stats.tokens" />
      <StatCard label="管理员" :value="stats.admins" />
    </div>
    <div class="card recent">
      <div class="recent-head">最近注册的表</div>
      <el-table v-if="recent.length" :data="recent" size="default">
        <el-table-column prop="name" label="表名" min-width="160">
          <template #default="{ row }"><span class="mono">{{ row.name }}</span></template>
        </el-table-column>
        <el-table-column prop="label" label="标签" min-width="120" />
        <el-table-column label="字段数" width="90">
          <template #default="{ row }">{{ row.fields.length }}</template>
        </el-table-column>
        <el-table-column label="操作" width="110">
          <template #default="{ row }">
            <el-button link type="primary" @click="router.push({ name: 'table-data', params: { id: row.id } })">查看数据</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div v-else class="recent-empty">
        暂无表，去
        <el-button link type="primary" @click="router.push({ name: 'table-new' })">新建模型</el-button>
      </div>
    </div>
  </div>
</template>
<style scoped>
.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 20px;
}
.recent {
  padding: 8px 16px 16px;
}
.recent-head {
  padding: 12px 4px;
  font-weight: 700;
  font-size: 15px;
}
.recent-empty {
  padding: 24px;
  color: var(--c-text-muted);
}
@media (max-width: 720px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }
}
</style>
