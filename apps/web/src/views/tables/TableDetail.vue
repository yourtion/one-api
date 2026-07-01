<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { getTable, updateTable, refreshTable } from '../../api/index.js';
import { formatTs } from '../../lib/format.js';
import type { TableMeta } from '@1api/shared';

const route = useRoute();
const router = useRouter();
const meta = ref<TableMeta | null>(null);
const loading = ref(false);
const saving = ref(false);
const id = () => Number(route.params.id);

async function load() {
  loading.value = true;
  try {
    meta.value = await getTable(id());
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function onSave() {
  if (!meta.value) return;
  saving.value = true;
  try {
    await updateTable(meta.value.id, {
      label: meta.value.label,
      note: meta.value.note,
      isPublished: meta.value.isPublished,
      isEditable: meta.value.isEditable,
    });
    ElMessage.success('已保存');
    await load();
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    saving.value = false;
  }
}

async function onRefresh() {
  try {
    await refreshTable(id());
    await load();
    ElMessage.success('已刷新结构');
  } catch (e) {
    ElMessage.error((e as Error).message);
  }
}
</script>

<template>
  <div class="page" v-loading="loading">
    <div class="page-header">
      <h1 class="page-title">
        表详情
        <span v-if="meta" class="mono" style="color: var(--c-text-muted); font-size: 15px">{{ meta.name }}</span>
      </h1>
      <div>
        <el-button @click="onRefresh">刷新结构</el-button>
        <el-button @click="router.push({ name: 'table-data', params: { id: id() } })">数据</el-button>
      </div>
    </div>
    <template v-if="meta">
      <div class="card" style="padding: 24px; max-width: 820px; margin-bottom: 16px">
        <el-form label-width="100px">
          <el-form-item label="表名"><span class="mono">{{ meta.name }}</span></el-form-item>
          <el-form-item label="主键"><span class="mono">{{ meta.primaryKey }}</span></el-form-item>
          <el-form-item label="标签"><el-input v-model="meta.label" /></el-form-item>
          <el-form-item label="备注"><el-input v-model="meta.note" /></el-form-item>
          <el-form-item label="发布"><el-switch v-model="meta.isPublished" /></el-form-item>
          <el-form-item label="可编辑"><el-switch v-model="meta.isEditable" /></el-form-item>
          <el-form-item label="创建时间">{{ formatTs(meta.createdAt) }}</el-form-item>
          <el-form-item><el-button type="primary" :loading="saving" @click="onSave">保存</el-button></el-form-item>
        </el-form>
      </div>
      <div class="card" style="padding: 16px">
        <div style="font-weight: 700; padding: 4px 0 12px">字段（结构只读展示）</div>
        <el-table :data="meta.fields" size="small" border>
          <el-table-column prop="name" label="字段名" min-width="140">
            <template #default="{ row }"><span class="mono">{{ row.name }}</span></template>
          </el-table-column>
          <el-table-column prop="label" label="标签" min-width="120" />
          <el-table-column prop="jsonType" label="类型" width="100" />
          <el-table-column label="主键" width="70">
            <template #default="{ row }">{{ row.isPrimary ? '是' : '' }}</template>
          </el-table-column>
          <el-table-column label="可空" width="70">
            <template #default="{ row }">{{ row.nullable ? '是' : '' }}</template>
          </el-table-column>
          <el-table-column label="隐藏" width="70">
            <template #default="{ row }">{{ row.isHidden ? '是' : '' }}</template>
          </el-table-column>
        </el-table>
      </div>
    </template>
  </div>
</template>
