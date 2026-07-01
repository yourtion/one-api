<script setup lang="ts">
import { ref, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '../stores/auth.js';
import { ApiRequestError } from '../api/index.js';

const router = useRouter();
const auth = useAuthStore();
const form = reactive({ name: 'admin', password: '' });
const loading = ref(false);

async function onSubmit() {
  if (!form.name || !form.password) {
    ElMessage.warning('请输入账号和密码');
    return;
  }
  loading.value = true;
  try {
    await auth.login(form.name, form.password);
    if (auth.mustChangePassword) router.replace({ name: 'change-password' });
    else router.replace({ name: 'dashboard' });
  } catch (e) {
    const msg = e instanceof ApiRequestError ? e.message : '登录失败';
    ElMessage.error(msg);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-wrap">
    <div class="login-card card">
      <div class="login-brand">
        <span class="brand-mark">◆</span>
        <h1 class="login-title">one-api</h1>
        <p class="login-sub">AI native 数据库 · 控制台</p>
      </div>
      <el-form label-position="top" @submit.prevent="onSubmit">
        <el-form-item label="账号">
          <el-input v-model="form.name" placeholder="admin" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            placeholder="123456"
            @keyup.enter="onSubmit"
          />
        </el-form-item>
        <el-button type="primary" :loading="loading" @click="onSubmit" style="width: 100%">登录</el-button>
      </el-form>
      <p class="login-hint">默认账号 admin / 123456，首次登录需修改密码</p>
    </div>
  </div>
</template>

<style scoped>
.login-wrap {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(1200px 600px at 50% -10%, var(--c-primary-soft), var(--c-bg));
}
.login-card {
  width: 380px;
  padding: 36px 32px;
}
.login-brand {
  text-align: center;
  margin-bottom: 24px;
}
.brand-mark {
  color: var(--c-primary);
  font-size: 30px;
}
.login-title {
  margin: 6px 0 2px;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.02em;
}
.login-sub {
  margin: 0;
  color: var(--c-text-muted);
  font-size: 13px;
}
.login-hint {
  margin: 16px 0 0;
  color: var(--c-text-muted);
  font-size: 12px;
  text-align: center;
}
</style>
