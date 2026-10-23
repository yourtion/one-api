import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ElementPlus, { ElDatePicker, ElSelect, ElSwitch } from 'element-plus';
import type { FieldMeta } from '@1api/shared';
import { JsonEditor, setupEditor } from '../lib/editor.js';
import { fieldsToEditorSchema } from '../lib/schema-adapter.js';

const field = (name: string, jsonType: FieldMeta['jsonType']): FieldMeta => ({
  name,
  label: name,
  sqliteType: 'TEXT',
  jsonType,
  nullable: false,
  defaultValue: null,
  isPrimary: false,
  isAutoIncrement: false,
  isHidden: false,
  isReadonly: false,
});

describe('JsonEditor 日期时间适配', () => {
  it('datetime 渲染日期时间选择器，保留 Date 模型与 boolean/enum 控件', async () => {
    setupEditor();
    const schema = fieldsToEditorSchema([
      field('event_time', 'datetime'),
      field('active', 'boolean'),
      { ...field('status', 'string'), enumValues: ['draft', 'published'] },
    ]);
    const wrapper = mount(JsonEditor, {
      props: { schema, modelValue: { active: true, status: 'draft' } },
      global: { plugins: [ElementPlus] },
    });

    try {
      const picker = wrapper.findComponent(ElDatePicker);
      expect(picker.props('type')).toBe('datetime');
      expect(wrapper.findComponent(ElSwitch).props('modelValue')).toBe(true);
      expect(wrapper.findComponent(ElSelect).props('modelValue')).toBe('draft');

      const selected = new Date(2026, 9, 24, 13, 14, 15);
      picker.vm.$emit('update:modelValue', selected);
      await wrapper.vm.$nextTick();
      const model = wrapper.emitted('update:modelValue')?.at(-1)?.[0];
      expect(model).toMatchObject({ event_time: selected, active: true, status: 'draft' });
      expect(JSON.parse(JSON.stringify(model)).event_time).toBe(selected.toISOString());
    } finally {
      wrapper.unmount();
    }
  });
});
