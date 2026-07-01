<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useAuthStore } from '../stores/auth.js';
import { ElMessage, ElMessageBox } from 'element-plus';
import { listAdmins, createAdmin, updateAdmin, deleteAdmin } from '../api/index.js';
import { formatTs } from '../lib/format.js';
import type { AdminVO } from '../api/types.js';
import EmptyState from '../components/EmptyState.vue';

const auth = useAuthStore();
const admins = ref<AdminVO[]>([]);
const loading = ref(false);

const dlgVisible = ref(false);
const form = reactive({ name: '', nickname: '', password: '' });

const resetDlg = reactive({ visible: false, id: 0, nickname: '', password: '' });

onMounted(load);
async function load() {
  loading.value = true;
  try {
    admins.value = await listAdmins();
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  form.name = '';
  form.nickname = '';
  form.password = '';
  dlgVisible.value = true;
}

async function onCreate() {
  if (!form.name || form.password.length < 6) {
    ElMessage.warning('账号必填，密码≥6位');
    return;
  }
  try {
    await createAdmin(form.name, form.nickname || form.name, form.password);
    dlgVisible.value = false;
    await load();
    ElMessage.success('已创建');
  } catch (e) {
    ElMessage.error((e as Error).message);
  }
}

function openReset(a: AdminVO) {
  resetDlg.id = a.id;
  resetDlg.nickname = a.nickname;
  resetDlg.password = '';
  resetDlg.visible = true;
}

async function onReset() {
  if (resetDlg.password && resetDlg.password.length < 6) {
    ElMessage.warning('密码≥6位');
    return;
  }
  try {
    const patch: { nickname?: string; password?: string } = {};
    if (resetDlg.nickname) patch.nickname = resetDlg.nickname;
    if (resetDlg.password) patch.password = resetDlg.password;
    await updateAdmin(resetDlg.id, patch);
    resetDlg.visible = false;
    await load();
    ElMessage.success('已更新');
  } catch (e) {
    ElMessage.error((e as Error).message);
  }
}

async function onDelete(a: AdminVO) {
  if (a.id === auth.currentUser?.id) {
    ElMessage.warning('不可删除自己');
    return;
  }
  try {
    await ElMessageBox.confirm(`确定删除管理员「${a.name}」？`, '删除确认', { type: 'warning' });
    await deleteAdmin(a.id);
    await load();
    ElMessage.success('已删除');
  } catch (e) {
    if (e !== 'cancel') ElMessage.error((e as Error).message);
  }
}
</script>

<template>
  <div class="page" v-loading="loading">
    <div class="page-header">
      <h1 class="page-title">管理员管理</h1>
      <el-button type="primary" @click="openCreate">新建管理员</el-button>
    </div>
    <div class="card">
      <el-table v-if="admins.length" :data="admins">
        <el-table-column prop="name" label="账号" min-width="140">
          <template #default="{ row }"><span class="mono">{{ row.name }}</span></template>
        </el-table-column>
        <el-table-column prop="nickname" label="昵称" min-width="140" />
        <el-table-column label="待改密" width="100">
          <template #default="{ row }">
            <el-tag v-if="row.must_change_password" type="warning" size="small">待改密</el-tag>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="160">
          <template #default="{ row }">{{ formatTs(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button link @click="openReset(row)">编辑/改密</el-button>
            <el-button link type="danger" :disabled="row.id === auth.currentUser?.id" @click="onDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <EmptyState v-else text="没有管理员" />
    </div>

    <el-dialog v-model="dlgVisible" title="新建管理员" width="460px">
      <el-form label-width="80px">
        <el-form-item label="账号"><el-input v-model="form.name" class="mono" /></el-form-item>
        <el-form-item label="昵称"><el-input v-model="form.nickname" /></el-form-item>
        <el-form-item label="密码"><el-input v-model="form.password" type="password" show-password /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlgVisible = false">取消</el-button>
        <el-button type="primary" @click="onCreate">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="resetDlg.visible" title="编辑管理员" width="460px">
      <el-form label-width="80px">
        <el-form-item label="昵称"><el-input v-model="resetDlg.nickname" /></el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="resetDlg.password" type="password" show-password placeholder="留空则不改；改密将要求对方下次登录改密" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="resetDlg.visible = false">取消</el-button>
        <el-button type="primary" @click="onReset">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
