import JsonEditor from 'vue-json-ui-editor';
import type { OptionContext } from 'vue-json-ui-editor';
import { ElOption, ElButton, ElIcon } from 'element-plus';
import { Plus, Delete } from '@element-plus/icons-vue';
import { h } from 'vue';

// vue-json-ui-editor v3.1+ 已导出正式类型，setComponent 无需 as any
const setComponent = JsonEditor.setComponent;

// object 数组增删行按钮：圆形图标（+ 添加 / 回收站删除）
const AddIconButton = {
  render() {
    return h(ElButton, { circle: true, size: 'small', type: 'primary' }, () => h(ElIcon, () => h(Plus)));
  },
};
const RemoveIconButton = {
  render() {
    return h(ElButton, { circle: true, size: 'small', type: 'danger', plain: true }, () =>
      h(ElIcon, () => h(Delete)),
    );
  },
};

let registered = false;

/**
 * 注册 element-plus 组件到 JsonEditor（模块级单例，应用启动调一次）。
 * 字段 widget 由 schema 的 attrs.type 决定：switch/date/textarea 等。
 */
export function setupEditor(): void {
  if (registered) return;
  registered = true;

  setComponent('form', 'el-form', ({ vm }: OptionContext) => ({ labelWidth: '110px', model: vm.model }));
  setComponent('label', 'el-form-item', ({ field }: OptionContext) => ({ prop: field.name, label: field.label }));
  setComponent('error', 'el-alert', ({ vm }: OptionContext) => ({ type: 'error', title: vm.error, closable: false }));

  setComponent('text', 'el-input');
  setComponent('textarea', 'el-input');
  setComponent('number', 'el-input-number');
  setComponent('select', 'el-select');
  setComponent('option', ElOption);
  setComponent('switch', 'el-switch');
  setComponent('date', 'el-date-picker'); // datetime 自定义类型
  // object 数组增删行按钮 → 圆形图标
  setComponent('arrayadd', AddIconButton);
  setComponent('arrayremove', RemoveIconButton);
}

export { JsonEditor };
