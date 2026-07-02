<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { importTable, updateTable } from '../../api/index.js';
import type { TableMeta } from '@1api/shared';

const router = useRouter();
const name = ref('');
const meta = ref<TableMeta | null>(null);
const loading = ref(false);

async function onPreview() {
  if (!name.value) {
    ElMessage.warning('请输入表名');
    return;
  }
  loading.value = true;
  try {
    meta.value = await importTable(name.value);
    ElMessage.success('已推断字段');
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    loading.value = false;
  }
}

async function onSave() {
  if (!meta.value) return;
  loading.value = true;
  try {
    await updateTable(meta.value.id, { label: meta.value.label, note: meta.value.note });
    ElMessage.success('已保存');
    router.replace({ name: 'table-data', params: { id: meta.value.id } });
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1 class="page-title">导入已有表</h1>
      <el-button @click="router.back()">返回</el-button>
    </div>
    <div class="card" style="padding: 24px; max-width: 820px">
      <el-form label-width="100px" @submit.prevent="onPreview">
        <el-form-item label="业务库表名">
          <el-input v-model="name" placeholder="如 users" class="mono" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="onPreview">预览结构</el-button>
        </el-form-item>
      </el-form>

      <template v-if="meta">
        <el-divider content-position="left">推断的字段</el-divider>
        <el-form label-width="100px">
          <el-form-item label="标签">
            <el-input v-model="meta.label" />
          </el-form-item>
          <el-form-item label="备注">
            <el-input v-model="meta.note" />
          </el-form-item>
        </el-form>
        <el-table :data="meta.fields" size="small" border>
          <el-table-column prop="name" label="字段名" min-width="140">
            <template #default="{ row }"><span class="mono">{{ row.name }}</span></template>
          </el-table-column>
          <el-table-column prop="jsonType" label="类型" width="100" />
          <el-table-column label="主键" width="70">
            <template #default="{ row }">{{ row.isPrimary ? '是' : '' }}</template>
          </el-table-column>
          <el-table-column label="可空" width="70">
            <template #default="{ row }">{{ row.nullable ? '是' : '' }}</template>
          </el-table-column>
        </el-table>
        <div style="margin-top: 16px">
          <el-button type="primary" :loading="loading" @click="onSave">保存</el-button>
        </div>
      </template>
    </div>
  </div>
</template>
