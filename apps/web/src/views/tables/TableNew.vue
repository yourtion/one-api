<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import JsonEditor from 'vue-json-ui-editor';
import { createTable } from '../../api/index.js';
import { isValidName, isReservedName } from '@1api/shared';
import type { FieldMetaInput } from '../../api/types.js';

const router = useRouter();
const form = reactive({ name: '', label: '', note: '', autoTimestamps: true });
const loading = ref(false);

// JsonEditor 渲染 fields 数组（object array items 增删行）
// model 结构：{ fields: [{name,label,jsonType,nullable}] }
const fieldsModel = ref<{ fields: Array<{ name: string; label: string; jsonType: string; nullable: boolean }> }>({
  fields: [],
});

// 字段定义 schema：name（string）/ label（string）/ jsonType（enum 下拉）/ nullable（switch）
const fieldsSchema = {
  type: 'object',
  properties: {
    fields: {
      type: 'array',
      title: '字段定义',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', title: '字段名' },
          label: { type: 'string', title: '标签' },
          jsonType: {
            type: 'string',
            title: '类型',
            enum: ['string', 'integer', 'number', 'boolean', 'datetime'],
          },
          nullable: { type: 'boolean', title: '可空', default: false, attrs: { type: 'switch' } },
        },
      },
    },
  },
};

// 提取校验通过的字段
const validFields = computed<FieldMetaInput[]>(() =>
  (fieldsModel.value.fields || [])
    .filter((f) => f.name && f.jsonType)
    .map((f): FieldMetaInput => {
      const item: FieldMetaInput = {
        name: f.name,
        jsonType: f.jsonType as FieldMetaInput['jsonType'],
        nullable: f.nullable,
      };
      // exactOptionalPropertyTypes：仅当存在时挂载 label
      if (f.label) item.label = f.label;
      return item;
    }),
);

async function onSubmit() {
  if (!isValidName(form.name) || isReservedName(form.name)) {
    ElMessage.warning('表名需匹配 ^[a-z][a-z0-9_]*$ 且非保留字');
    return;
  }
  if (!form.label) {
    ElMessage.warning('请填写标签');
    return;
  }
  if (!validFields.value.length) {
    ElMessage.warning('至少添加一个字段');
    return;
  }
  if (validFields.value.some((f) => !isValidName(f.name))) {
    ElMessage.warning('字段名需 snake_case');
    return;
  }
  loading.value = true;
  try {
    const meta = await createTable({
      name: form.name,
      label: form.label,
      fields: validFields.value,
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
        <!-- vue-json-ui-editor 原生 object 数组增删行（替代手搓 FieldRowsEditor） -->
        <div class="fields-editor">
          <JsonEditor :schema="fieldsSchema" v-model="fieldsModel" />
        </div>
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
.fields-editor {
  margin-left: 100px;
  margin-bottom: 18px;
}
.fields-editor :deep(.json-editor-array-row) {
  display: flex;
  gap: 10px;
  align-items: center;
  margin: 8px 0;
  padding: 10px;
  background: var(--c-bg);
  border-radius: var(--radius-sm);
}
.fields-editor :deep(.json-editor-array-row-fields) {
  flex: 1;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.fields-editor :deep(.json-editor-array-row-fields .el-form-item) {
  margin-bottom: 0;
}
.fields-editor :deep(.json-editor-array-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 4px 0 2px;
}
.fields-editor :deep(.json-editor-array-title) {
  font-weight: 600;
  color: var(--c-text);
}
</style>
