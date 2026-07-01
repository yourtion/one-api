import JsonEditor from 'vue-json-ui-editor';
import { ElOption } from 'element-plus';

/** setComponent 的类型（库内用 as any 挂载，这里补类型签名） */
type SetComponent = (
  type: string,
  component: string | object,
  option?:
    | Record<string, unknown>
    | ((ctx: { vm: unknown; field: unknown; item: unknown }) => Record<string, unknown>),
) => void;
const setComponent = (JsonEditor as unknown as { setComponent: SetComponent }).setComponent.bind(JsonEditor);

let registered = false;

/**
 * 注册 element-plus 组件到 JsonEditor（模块级单例，应用启动调一次）。
 * 字段 widget 由 schema 的 attrs.type 决定：switch/date/textarea 等。
 */
export function setupEditor(): void {
  if (registered) return;
  registered = true;

  setComponent('form', 'el-form', ({ vm }) => ({ labelWidth: '110px', model: (vm as { model: unknown }).model }));
  setComponent('label', 'el-form-item', ({ field }) => ({ prop: (field as { name: string }).name }));
  setComponent('error', 'el-alert', ({ vm }) => ({
    type: 'error',
    title: (vm as { error: string }).error,
    closable: false,
  }));

  setComponent('text', 'el-input');
  setComponent('textarea', 'el-input');
  setComponent('number', 'el-input-number');
  setComponent('select', 'el-select');
  setComponent('option', ElOption);
  setComponent('switch', 'el-switch');
  setComponent('date', 'el-date-picker'); // datetime 自定义类型
}

export { JsonEditor };
