import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { TableMeta } from '@1api/shared';
import * as api from '../api/index.js';

export const useTableStore = defineStore('table', () => {
  const tables = ref<TableMeta[]>([]);
  const current = ref<TableMeta | null>(null);
  const loading = ref(false);

  async function loadAll(): Promise<void> {
    loading.value = true;
    try { tables.value = await api.listTables(); } finally { loading.value = false; }
  }

  async function loadOne(id: number): Promise<TableMeta> {
    loading.value = true;
    try {
      const m = await api.getTable(id);
      current.value = m;
      // 同步刷新列表中该项
      const idx = tables.value.findIndex((t) => t.id === id);
      if (idx >= 0) tables.value[idx] = m;
      return m;
    } finally {
      loading.value = false;
    }
  }

  function clearCurrent(): void { current.value = null; }

  return { tables, current, loading, loadAll, loadOne, clearCurrent };
});
