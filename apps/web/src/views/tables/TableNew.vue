<script setup lang="ts">
import { ref, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { createTable } from '../../api/index.js';
import { isValidName, isReservedName } from '@1api/shared';
import type { FieldMetaInput } from '../../api/types.js';
import FieldRowsEditor from '../../components/FieldRowsEditor.vue';

const router = useRouter();
const form = reactive({ name: '', label: '', note: '', autoTimestamps: true });
const fields = ref<FieldMetaInput[]>([]);
const loading = ref(false);

async function onSubmit() {
  if (!isValidName(form.name) || isReservedName(form.name)) {
    ElMessage.warning('表名需匹配 ^[a-z][a-z0-9_]*$ 且非保留字');
    return;
  }
  if (!form.label) {
    ElMessage.warning('请填写标签');
    return;
  }
  const valid = fields.value.filter((f) => f.name && f.jsonType);
  if (!valid.length) {
    ElMessage.warning('至少添加一个字段');
    return;
  }
  if (valid.some((f) => !isValidName(f.name))) {
    ElMessage.warning('字段名需 snake_case');
    return;
  }
  loading.value = true;
  try {
    const meta = await createTable({
      name: form.name,
      label: form.label,
      fields: valid,
      note: form.note || null,
      autoTimestamps: form.autoTimestamps,
    });
    ElMessage.success('已创建');
    router.replace({ name: 'table-data', params: { id: meta.id } });
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
      <h1 class="page-title">新建模型</h1>
      <el-button @click="router.back()">返回</el-button>
    </div>
    <div class="card form-card">
      <el-form label-width="100px">
        <el-form-item label="表名">
          <el-input v-model="form.name" placeholder="如 articles" class="mono" />
        </el-form-item>
        <el-form-item label="标签">
          <el-input v-model="form.label" placeholder="如 文章" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.note" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="自动时间戳">
          <el-switch v-model="form.autoTimestamps" />
        </el-form-item>
        <el-divider content-position="left">字段定义</el-divider>
        <FieldRowsEditor v-model="fields" />
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="onSubmit">创建模型</el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>
<style scoped>
.form-card {
  padding: 24px;
  max-width: 820px;
}
</style>
