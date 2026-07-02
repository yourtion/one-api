<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { listTables, listTokens, createToken, updateToken, deleteToken } from '../api/index.js';
import { formatTs } from '../lib/format.js';
import type { TokenListVO } from '../api/types.js';
import type { TableMeta, TokenPermissions } from '@1api/shared';
import EmptyState from '../components/EmptyState.vue';

const tokens = ref<TokenListVO[]>([]);
const tables = ref<TableMeta[]>([]);
const loading = ref(false);

// 对话框（创建 / 编辑共用表单）
const dlgVisible = ref(false);
const dlgMode = ref<'create' | 'edit'>('create');
const editingId = ref<number | null>(null);
const form = reactive({
  name: '',
  tables: [] as string[],
  wildcard: false,
  actions: ['read'] as TokenPermissions['actions'],
  allowSchema: false,
});
const newToken = ref<string | null>(null);

const dlgTitle = computed(() => (dlgMode.value === 'create' ? '新建 Token' : '编辑 Token'));

const allActions: Array<{ value: TokenPermissions['actions'][number]; label: string }> = [
  { value: 'read', label: '读' },
  { value: 'write', label: '写' },
];

onMounted(async () => {
  loading.value = true;
  try {
    [tokens.value, tables.value] = await Promise.all([listTokens(), listTables()]);
  } finally {
    loading.value = false;
  }
});

function resetForm() {
  form.name = '';
  form.tables = [];
  form.wildcard = false;
  form.actions = ['read'];
  form.allowSchema = false;
  newToken.value = null;
  editingId.value = null;
}

function openCreate() {
  resetForm();
  dlgMode.value = 'create';
  dlgVisible.value = true;
}

function openEdit(t: TokenListVO) {
  resetForm();
  dlgMode.value = 'edit';
  editingId.value = t.id;
  form.name = t.name;
  const wildcard = t.permissions.tables.includes('*');
  form.wildcard = wildcard;
  form.tables = wildcard ? [] : t.permissions.tables;
  form.actions = t.permissions.actions.filter((a) => a !== 'schema') as TokenPermissions['actions'];
  form.allowSchema = t.permissions.actions.includes('schema');
  dlgVisible.value = true;
}

function buildPerms(): TokenPermissions {
  return {
    tables: form.wildcard ? ['*'] : form.tables,
    actions: form.allowSchema ? [...form.actions, 'schema'] : form.actions,
  };
}

async function onSubmit() {
  if (dlgMode.value === 'edit') {
    if (!form.name) {
      ElMessage.warning('请填写名称');
      return;
    }
    if (!form.wildcard && form.tables.length === 0) {
      ElMessage.warning('请选择表或勾选全部');
      return;
    }
    try {
      await updateToken(editingId.value!, { name: form.name, permissions: buildPerms() });
      tokens.value = await listTokens();
      ElMessage.success('已更新');
      dlgVisible.value = false;
    } catch (e) {
      ElMessage.error((e as Error).message);
    }
    return;
  }
  // create
  if (!form.name) {
    ElMessage.warning('请填写名称');
    return;
  }
  if (!form.wildcard && form.tables.length === 0) {
    ElMessage.warning('请选择表或勾选全部');
    return;
  }
  try {
    const r = await createToken(form.name, buildPerms());
    newToken.value = r.token;
    tokens.value = await listTokens();
    ElMessage.success('已创建，请立即复制明文');
  } catch (e) {
    ElMessage.error((e as Error).message);
  }
}

async function toggleActive(t: TokenListVO) {
  try {
    await updateToken(t.id, { isActive: !t.is_active });
    tokens.value = await listTokens();
  } catch (e) {
    ElMessage.error((e as Error).message);
  }
}

async function onDelete(t: TokenListVO) {
  try {
    await ElMessageBox.confirm(`确定删除 Token「${t.name}」？`, '删除确认', { type: 'warning' });
    await deleteToken(t.id);
    tokens.value = await listTokens();
    ElMessage.success('已删除');
  } catch (e) {
    if (e !== 'cancel') ElMessage.error((e as Error).message);
  }
}

async function copyToken() {
  if (!newToken.value) return;
  await navigator.clipboard.writeText(newToken.value);
  ElMessage.success('已复制');
}
</script>

<template>
  <div class="page" v-loading="loading">
    <div class="page-header">
      <h1 class="page-title">Token 管理</h1>
      <el-button type="primary" @click="openCreate">新建 Token</el-button>
    </div>
    <div class="card">
      <el-table v-if="tokens.length" :data="tokens">
        <el-table-column prop="name" label="名称" min-width="140" />
        <el-table-column label="前缀" width="140">
          <template #default="{ row }"><span class="mono">{{ row.token_prefix }}</span></template>
        </el-table-column>
        <el-table-column label="权限" min-width="200">
          <template #default="{ row }">
            <span class="mono">{{ row.permissions.tables.join(',') }} · {{ row.permissions.actions.join(',') }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }"><el-switch :model-value="row.is_active" @change="toggleActive(row)" /></template>
        </el-table-column>
        <el-table-column label="最近使用" width="150">
          <template #default="{ row }">{{ formatTs(row.last_used_at) }}</template>
        </el-table-column>
        <el-table-column label="创建时间" width="150">
          <template #default="{ row }">{{ formatTs(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" @click="onDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <EmptyState v-else text="还没有 Token" />
    </div>

    <el-dialog v-model="dlgVisible" :title="dlgTitle" width="520px">
      <el-form label-width="90px">
        <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="全部表"><el-switch v-model="form.wildcard" /></el-form-item>
        <el-form-item v-if="!form.wildcard" label="表">
          <el-select v-model="form.tables" multiple placeholder="选择表" style="width: 100%">
            <el-option v-for="t in tables" :key="t.id" :label="t.name" :value="t.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="动作">
          <el-checkbox-group v-model="form.actions">
            <el-checkbox v-for="a in allActions" :key="a.value" :value="a.value">{{ a.label }}</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="允许 Schema 变更"><el-switch v-model="form.allowSchema" /></el-form-item>
      </el-form>

      <el-alert v-if="newToken" type="warning" :closable="false" style="margin-top: 12px">
        <template #title>
          <div class="token-once">
            <span class="mono">{{ newToken }}</span>
            <el-button size="small" type="primary" @click="copyToken">复制</el-button>
          </div>
        </template>
        <div style="margin-top: 6px">明文仅显示一次，离开后无法再获取。</div>
      </el-alert>

      <template #footer>
        <el-button @click="dlgVisible = false">{{ newToken ? '我已保存' : '取消' }}</el-button>
        <el-button v-if="!newToken" type="primary" @click="onSubmit">
          {{ dlgMode === 'create' ? '创建' : '保存' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>
<style scoped>
.token-once {
  display: flex;
  align-items: center;
  gap: 10px;
}
.token-once .mono {
  word-break: break-all;
}
</style>
