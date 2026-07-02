<script setup lang="ts">
import { ref, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '../stores/auth.js';
import { ApiRequestError } from '../api/index.js';

const router = useRouter();
const auth = useAuthStore();
const form = reactive({ oldPassword: '', newPassword: '', confirm: '' });
const loading = ref(false);

async function onSubmit() {
  if (form.newPassword.length < 6) {
    ElMessage.warning('新密码至少 6 位');
    return;
  }
  if (form.newPassword !== form.confirm) {
    ElMessage.warning('两次密码不一致');
    return;
  }
  loading.value = true;
  try {
    await auth.changePassword(form.oldPassword, form.newPassword);
    ElMessage.success('密码已修改');
    router.replace({ name: 'dashboard' });
  } catch (e) {
    ElMessage.error(e instanceof ApiRequestError ? e.message : '修改失败');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="cp-wrap">
    <div class="card cp-card">
      <h2 class="cp-title">修改密码</h2>
      <p class="cp-sub">首次登录或管理员重置后需设置新密码</p>
      <el-form label-position="top" @submit.prevent="onSubmit">
        <el-form-item label="当前密码">
          <el-input v-model="form.oldPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="新密码（≥6 位）">
          <el-input v-model="form.newPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="确认新密码">
          <el-input v-model="form.confirm" type="password" show-password @keyup.enter="onSubmit" />
        </el-form-item>
        <el-button type="primary" :loading="loading" @click="onSubmit" style="width: 100%">提交</el-button>
      </el-form>
    </div>
  </div>
</template>
<style scoped>
.cp-wrap {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--c-bg);
}
.cp-card {
  width: 420px;
  padding: 32px;
}
.cp-title {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 700;
}
.cp-sub {
  margin: 0 0 20px;
  color: var(--c-text-muted);
  font-size: 13px;
}
</style>
