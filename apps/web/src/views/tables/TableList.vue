<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { listTables, deleteTable, refreshTable } from '../../api/index.js';
import { useTableStore } from '../../stores/table.js';
import { formatTs } from '../../lib/format.js';
import type { TableMeta } from '@1api/shared';
import EmptyState from '../../components/EmptyState.vue';

const router = useRouter();
const store = useTableStore();
const loading = ref(true);

onMounted(async () => {
  try {
    await store.loadAll();
  } finally {
    loading.value = false;
  }
});

async function onRefresh(t: TableMeta) {
  try {
    await refreshTable(t.id);
    await store.loadAll();
    ElMessage.success(`已刷新「${t.name}」结构`);
  } catch (e) {
    ElMessage.error((e as Error).message);
  }
}

async function onDelete(t: TableMeta) {
  try {
    await ElMessageBox.confirm(`确定删除表「${t.name}」的注册？（不删业务库数据，仅删元数据）`, '删除确认', { type: 'warning' });
    await deleteTable(t.id);
    await store.loadAll();
    ElMessage.success('已删除注册');
  } catch (e) {
    if (e !== 'cancel') ElMessage.error((e as Error).message);
  }
}
</script>

<template>
  <div class="page" v-loading="loading">
    <div class="page-header">
      <h1 class="page-title">表管理</h1>
      <div>
        <el-button @click="router.push({ name: 'table-import' })">导入已有表</el-button>
        <el-button type="primary" @click="router.push({ name: 'table-new' })">新建模型</el-button>
      </div>
    </div>
    <div class="card">
      <el-table v-if="store.tables.length" :data="store.tables">
        <el-table-column label="表名" min-width="160">
          <template #default="{ row }"><span class="mono">{{ row.name }}</span></template>
        </el-table-column>
        <el-table-column prop="label" label="标签" min-width="120" />
        <el-table-column label="字段数" width="84">
          <template #default="{ row }">{{ row.fields.length }}</template>
        </el-table-column>
        <el-table-column label="状态" width="150">
          <template #default="{ row }">
            <el-tag v-if="row.isPublished" type="success" size="small">已发布</el-tag>
            <el-tag v-else type="info" size="small">未发布</el-tag>
            <el-tag v-if="row.isEditable" size="small" style="margin-left: 4px">可编辑</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="150">
          <template #default="{ row }">{{ formatTs(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="router.push({ name: 'table-data', params: { id: row.id } })">数据</el-button>
            <el-button link @click="router.push({ name: 'table-detail', params: { id: row.id } })">编辑</el-button>
            <el-button link @click="onRefresh(row)">刷新结构</el-button>
            <el-button link type="danger" @click="onDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <EmptyState v-else text="还没有注册任何表" />
    </div>
  </div>
</template>
