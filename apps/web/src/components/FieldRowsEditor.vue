<script setup lang="ts">
import { Plus, Delete } from '@element-plus/icons-vue';
import type { FieldMetaInput } from '../api/types.js';

const props = defineProps<{ modelValue: FieldMetaInput[] }>();
const emit = defineEmits<{ 'update:modelValue': [FieldMetaInput[]] }>();

const JSON_TYPES: FieldMetaInput['jsonType'][] = ['string', 'integer', 'number', 'boolean', 'datetime'];

function setField(
  i: number,
  key: 'name' | 'label' | 'jsonType' | 'nullable',
  v: string | FieldMetaInput['jsonType'] | boolean,
): void {
  const cp = [...props.modelValue];
  const old = cp[i];
  if (!old) return;
  // 显式重构，可选属性条件挂载（exactOptionalPropertyTypes）
  const next: FieldMetaInput = {
    name: key === 'name' ? (v as string) : old.name,
    jsonType: key === 'jsonType' ? (v as FieldMetaInput['jsonType']) : old.jsonType,
  };
  // 可选属性：仅当存在时挂载
  const labelVal = key === 'label' ? (v as string) : old.label;
  if (labelVal !== undefined) next.label = labelVal;
  const nullableVal = key === 'nullable' ? (v as boolean) : old.nullable;
  if (nullableVal !== undefined) next.nullable = nullableVal;
  cp[i] = next;
  emit('update:modelValue', cp);
}

function add(): void {
  emit('update:modelValue', [...props.modelValue, { name: '', jsonType: 'string', label: '', nullable: false }]);
}

function remove(i: number): void {
  emit('update:modelValue', props.modelValue.filter((_, idx) => idx !== i));
}
</script>

<template>
  <div class="fre">
    <div v-if="props.modelValue.length" class="fre-rows">
      <div class="fre-head">
        <span class="c-name">字段名</span>
        <span class="c-label">标签</span>
        <span class="c-type">类型</span>
        <span class="c-bool">可空</span>
        <span class="c-act"></span>
      </div>
      <div v-for="(row, i) in props.modelValue" :key="i" class="fre-row">
        <el-input
          class="c-name"
          :model-value="row.name"
          placeholder="snake_case"
          size="small"
          @update:model-value="(v: string) => setField(i, 'name', v)"
        />
        <el-input
          class="c-label"
          :model-value="row.label ?? ''"
          placeholder="显示名"
          size="small"
          @update:model-value="(v: string) => setField(i, 'label', v)"
        />
        <el-select
          class="c-type"
          :model-value="row.jsonType"
          size="small"
          @update:model-value="(v: string | number | boolean) => setField(i, 'jsonType', v as FieldMetaInput['jsonType'])"
        >
          <el-option v-for="t in JSON_TYPES" :key="t" :label="t" :value="t" />
        </el-select>
        <el-switch
          class="c-bool"
          :model-value="row.nullable ?? false"
          size="small"
          @update:model-value="(v: string | number | boolean) => setField(i, 'nullable', Boolean(v))"
        />
        <span class="c-act">
          <el-button :icon="Delete" link type="danger" @click="remove(i)" />
        </span>
      </div>
    </div>
    <el-button :icon="Plus" plain size="small" @click="add">添加字段</el-button>
  </div>
</template>
<style scoped>
.fre-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}
.fre-head,
.fre-row {
  display: grid;
  grid-template-columns: 1.4fr 1.2fr 1fr 60px 40px;
  gap: 8px;
  align-items: center;
}
.fre-head {
  color: var(--c-text-muted);
  font-size: 12px;
  font-weight: 600;
  padding: 0 4px;
}
</style>
