<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import JsonEditor from 'vue-json-ui-editor';
import { getTable, listData, createRecord, updateRecord, deleteRecord, exportCsv } from '../../api/index.js';
import { fieldsToEditorSchema } from '../../lib/schema-adapter.js';
import { formatCell } from '../../lib/format.js';
import type { TableMeta } from '@1api/shared';
import EmptyState from '../../components/EmptyState.vue';

const route = useRoute();
const id = () => Number(route.params.id);

const meta = ref<TableMeta | null>(null);
const rows = ref<Record<string, unknown>[]>([]);
const total = ref(0);
const loading = ref(false);

// 查询参数
const page = ref(1);
const size = ref(20);
const order = ref('');
const q = ref('');
// 字段精确过滤（field__eq=value），仅对字符串字段提供输入
const filters = ref<Record<string, string>>({});
const showFilters = ref(false);

// 弹窗：新增/编辑（vue-json-ui-editor）
const dlgVisible = ref(false);
const dlgMode = ref<'create' | 'edit'>('create');
const editingPk = ref<string | null>(null);
// JsonEditor ref：暴露 form()（返回 el-form 实例）与 reset()
const editorRef = ref<{ form: () => { validate: (cb: (v: boolean) => void) => void }; reset: () => void }>();
const formModel = ref<Record<string, unknown>>({});

const visibleFields = computed(() => (meta.value?.fields ?? []).filter((f) => !f.isHidden));
const canEdit = computed(() => meta.value?.isEditable ?? false);
// 可过滤字段：字符串类（含主键 integer 用 eq 精确匹配也合理）
const filterableFields = computed(() =>
  (meta.value?.fields ?? []).filter((f) => !f.isHidden && (f.jsonType === 'string' || f.jsonType === 'integer')),
);

// 新增模式：排除系统管理字段（自增主键/created_at/updated_at），避免 validate 失败
const createSchema = computed(() =>
  meta.value ? fieldsToEditorSchema(meta.value.fields, { excludeSystem: true }) : { type: 'object' as const, properties: {}, required: [] },
);
// 编辑模式：系统字段 readOnly 展示
const editSchema = computed(() =>
  meta.value ? fieldsToEditorSchema(meta.value.fields) : { type: 'object' as const, properties: {}, required: [] },
);

async function load() {
  loading.value = true;
  try {
    if (!meta.value) meta.value = await getTable(id());
    const query: Record<string, unknown> = { page: page.value, size: size.value };
    if (order.value) query['order'] = order.value;
    if (q.value) query['q'] = q.value;
    // 字段精确过滤：field__eq=value
    for (const [k, v] of Object.entries(filters.value)) {
      if (v) query[`${k}__eq`] = v;
    }
    const res = await listData<Record<string, unknown>>(id(), query);
    rows.value = res.rows;
    total.value = res.total;
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function openCreate() {
  dlgMode.value = 'create';
  editingPk.value = null;
  formModel.value = {};
  dlgVisible.value = true;
}
function openEdit(row: Record<string, unknown>) {
  dlgMode.value = 'edit';
  editingPk.value = String(row[meta.value!.primaryKey]);
  formModel.value = { ...row };
  dlgVisible.value = true;
}

async function onSubmit() {
  editorRef.value?.form().validate(async (valid) => {
    if (!valid) return;
    try {
      if (dlgMode.value === 'create') await createRecord(id(), { ...formModel.value });
      else await updateRecord(id(), editingPk.value!, { ...formModel.value });
      ElMessage.success('已保存');
      dlgVisible.value = false;
      await load();
    } catch (e) {
      ElMessage.error((e as Error).message);
    }
  });
}

async function onDelete(row: Record<string, unknown>) {
  const pk = String(row[meta.value!.primaryKey]);
  try {
    await ElMessageBox.confirm(`确定删除记录 ${pk}？`, '删除确认', { type: 'warning' });
    await deleteRecord(id(), pk);
    ElMessage.success('已删除');
    await load();
  } catch (e) {
    if (e !== 'cancel') ElMessage.error((e as Error).message);
  }
}

async function onExport() {
  try {
    const { blob, truncated, total: t } = await exportCsv(id(), { page: 1, size: 10000 });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${meta.value!.name}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    if (truncated) ElMessage.warning(`数据超 10000 行（共 ${t}），仅导出前 10000 行`);
  } catch (e) {
    ElMessage.error((e as Error).message);
  }
}

watch([page, size], load);
</script>

<template>
  <div class="page" v-loading="loading">
    <div class="page-header">
      <h1 class="page-title">
        数据
        <span v-if="meta" class="mono" style="font-size: 15px; color: var(--c-text-muted)">{{ meta.name }}</span>
      </h1>
      <div>
        <el-button @click="onExport">导出 CSV</el-button>
        <template v-if="canEdit">
          <el-button type="primary" @click="openCreate">新增</el-button>
        </template>
      </div>
    </div>

    <div class="card filter-bar">
      <el-input v-model="q" placeholder="关键词搜索" clearable style="width: 240px" @keyup.enter="load" />
      <el-select v-model="order" placeholder="排序" clearable style="width: 200px" @change="load">
        <el-option label="主键 倒序" :value="`${meta?.primaryKey}:desc`" />
        <el-option label="主键 正序" :value="`${meta?.primaryKey}:asc`" />
      </el-select>
      <el-button v-if="filterableFields.length" link type="primary" @click="showFilters = !showFilters">
        {{ showFilters ? '收起过滤' : '字段过滤' }}
      </el-button>
      <el-button @click="load">查询</el-button>
    </div>

    <div v-if="showFilters && filterableFields.length" class="card filter-bar" style="margin-bottom: 16px">
      <el-input
        v-for="f in filterableFields"
        :key="f.name"
        v-model="filters[f.name]"
        :placeholder="`${f.label || f.name} 精确匹配`"
        style="width: 200px"
        @keyup.enter="load"
      />
      <el-button @click="load">应用</el-button>
    </div>

    <div class="card">
      <el-table v-if="rows.length" :data="rows" size="default">
        <el-table-column
          v-for="f in visibleFields"
          :key="f.name"
          :prop="f.name"
          :label="f.label || f.name"
          min-width="140"
        >
          <template #default="{ row }">{{ formatCell(row[f.name], f) }}</template>
        </el-table-column>
        <el-table-column v-if="canEdit" label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" @click="onDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <EmptyState v-else text="暂无记录" />
    </div>

    <el-pagination
      v-if="total > 0"
      style="margin-top: 16px; justify-content: flex-end; display: flex"
      :current-page="page"
      :page-size="size"
      :total="total"
      :page-sizes="[20, 50, 100]"
      layout="total, sizes, prev, pager, next"
      @update:current-page="page = $event"
      @update:page-size="size = $event"
    />

    <!-- vue-json-ui-editor 用途①：数据编辑表单 -->
    <el-dialog v-model="dlgVisible" :title="dlgMode === 'create' ? '新增记录' : '编辑记录'" width="560px">
      <JsonEditor ref="editorRef" :schema="dlgMode === 'create' ? createSchema : editSchema" v-model="formModel" />
      <template #footer>
        <el-button @click="dlgVisible = false">取消</el-button>
        <el-button type="primary" @click="onSubmit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
<style scoped>
.filter-bar {
  display: flex;
  gap: 12px;
  padding: 14px 16px;
  margin-bottom: 16px;
  align-items: center;
}
</style>
