import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ListOptions, type TableMeta } from '@1api/shared';
import { createTestDbs, type TestDbs } from '../test-helpers.js';
import { DynamicSql } from '../dynamic-sql.js';

function meta(over: Partial<TableMeta> = {}): TableMeta {
  return {
    id: 1,
    name: 'posts',
    label: '文章',
    primaryKey: 'id',
    isPublished: true,
    isEditable: true,
    note: null,
    createdAt: 0,
    updatedAt: 0,
    fields: [
      {
        name: 'id',
        label: 'ID',
        sqliteType: 'INTEGER',
        jsonType: 'integer',
        nullable: false,
        defaultValue: null,
        isPrimary: true,
        isAutoIncrement: true,
        isHidden: false,
        isReadonly: true,
      },
      {
        name: 'title',
        label: '标题',
        sqliteType: 'TEXT',
        jsonType: 'string',
        nullable: false,
        defaultValue: null,
        isPrimary: false,
        isAutoIncrement: false,
        isHidden: false,
        isReadonly: false,
      },
      {
        name: 'views',
        label: '浏览',
        sqliteType: 'INTEGER',
        jsonType: 'integer',
        nullable: false,
        defaultValue: 0,
        isPrimary: false,
        isAutoIncrement: false,
        isHidden: false,
        isReadonly: false,
      },
      {
        name: 'created_at',
        label: '创建',
        sqliteType: 'TEXT',
        jsonType: 'datetime',
        nullable: true,
        defaultValue: null,
        isPrimary: false,
        isAutoIncrement: false,
        isHidden: false,
        isReadonly: true,
      },
    ],
    ...over,
  };
}

describe('DynamicSql', () => {
  let dbs: TestDbs;
  let dyn: DynamicSql;
  beforeEach(async () => {
    dbs = await createTestDbs();
    dbs.businessRaw.exec(
      'CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0, created_at TEXT)',
    );
    const ins = dbs.businessRaw.prepare(
      'INSERT INTO posts (title, views, created_at) VALUES (?, ?, ?)',
    );
    ins.run('a', 5, '2024-01-01T00:00:00Z');
    ins.run('b', 10, '2024-01-02T00:00:00Z');
    ins.run('c', 10, '2024-01-03 10:00:00'); // SQLite 原生格式
    dyn = new DynamicSql(dbs.businessDb);
  });
  afterEach(async () => {
    await dbs.cleanup();
  });

  describe('selectList', () => {
    it('基础 + 分页 + total', async () => {
      const r = await dyn.selectList(meta(), { page: 1, size: 2 });
      expect(r.rows).toHaveLength(2);
      expect(r.total).toBe(3);
      expect(r.page).toBe(1);
      expect(r.size).toBe(2);
    });

    it('排序 order=id:desc', async () => {
      const r = await dyn.selectList(meta(), { order: 'id:desc' });
      expect(r.rows.map((x) => x.id)).toEqual([3, 2, 1]);
    });

    it('过滤 eq / gt / in', async () => {
      expect((await dyn.selectList(meta(), { filters: { views: ['eq', 10] } })).total).toBe(2);
      expect((await dyn.selectList(meta(), { filters: { views: ['gt', 5] } })).total).toBe(2);
      expect((await dyn.selectList(meta(), { filters: { id: ['in', '1,3'] } })).total).toBe(2);
    });

    it('过滤 like', async () => {
      expect((await dyn.selectList(meta(), { filters: { title: ['like', '%a%'] } })).total).toBe(1);
    });

    it('过滤 ne / gte / lt / lte 全覆盖', async () => {
      // 数据：views = 5,10,10
      expect((await dyn.selectList(meta(), { filters: { views: ['ne', 5] } })).total).toBe(2);
      expect((await dyn.selectList(meta(), { filters: { views: ['gte', 10] } })).total).toBe(2);
      expect((await dyn.selectList(meta(), { filters: { views: ['lt', 10] } })).total).toBe(1);
      expect((await dyn.selectList(meta(), { filters: { views: ['lte', 5] } })).total).toBe(1);
    });

    it('不支持的过滤操作符 → VALIDATION_FAIL', async () => {
      await expect(
        dyn.selectList(meta(), { filters: { views: ['weird', 1] } }),
      ).rejects.toThrow(/VALIDATION_FAIL|不支持/);
    });

    it('in 操作符空值 → VALIDATION_FAIL', async () => {
      await expect(
        dyn.selectList(meta(), { filters: { id: ['in', ''] } }),
      ).rejects.toThrow(/VALIDATION_FAIL|in 操作符值非法/);
    });

    it('q 模糊（TEXT 非主键 OR LIKE）', async () => {
      expect((await dyn.selectList(meta(), { q: 'b' })).total).toBe(1);
    });

    describe('q 与字段过滤组合', () => {
      let searchMeta: TableMeta;

      beforeEach(() => {
        dbs.businessRaw.exec(
          'CREATE TABLE search_posts (id INTEGER PRIMARY KEY, views INTEGER, title TEXT, description TEXT)',
        );
        const fields = meta().fields.filter((f) => f.name !== 'created_at');
        const title = fields.find((f) => f.name === 'title')!;
        searchMeta = meta({
          name: 'search_posts',
          fields: [...fields, { ...title, name: 'description', label: '描述' }],
        });
        const insert = dbs.businessRaw.prepare(
          'INSERT INTO search_posts (id, views, title, description) VALUES (?, ?, ?, ?)',
        );
        insert.run(1, 1, 'needle', 'x');
        insert.run(2, 2, 'x', 'needle');
        insert.run(3, 1, 'x', 'needle');
        insert.run(4, 1, 'x', 'x');
        insert.run(5, 1, 'needle', 'needle');
        insert.run(6, 2, 'needle', 'x');
      });

      it('所有关键词命中列都必须满足字段过滤，双列命中只计一行', async () => {
        const result = await dyn.selectList(searchMeta, {
          filters: { views: ['eq', 1] },
          q: 'needle',
          order: 'id:asc',
        });
        expect(result.rows.map((row) => row.id)).toEqual([1, 3, 5]);
        expect(result.total).toBe(3);
      });

      it('多个过滤条件同时生效，分页与 total 使用相同条件', async () => {
        const options = {
          filters: { views: ['eq', 1], id: ['gt', 1] },
          q: 'needle',
          order: 'id:asc',
          size: 1,
        } satisfies ListOptions;
        for (const [page, expectedIds] of [[1, [3]], [2, [5]], [3, []]] as const) {
          const result = await dyn.selectList(searchMeta, { ...options, page });
          expect(result.rows.map((row) => row.id)).toEqual(expectedIds);
          expect(result.total).toBe(2);
          expect(result.page).toBe(page);
          expect(result.size).toBe(1);
        }
      });

      it('仅关键词仍跨文本列匹配，仅过滤仍按 AND 组合', async () => {
        const searched = await dyn.selectList(searchMeta, { q: 'needle', order: 'id:asc' });
        expect(searched.rows.map((row) => row.id)).toEqual([1, 2, 3, 5, 6]);
        expect(searched.total).toBe(5);
        const filtered = await dyn.selectList(searchMeta, {
          filters: { views: ['eq', 1], id: ['gt', 1] },
          order: 'id:asc',
        });
        expect(filtered.rows.map((row) => row.id)).toEqual([3, 4, 5]);
        expect(filtered.total).toBe(3);
      });

      it('组合查询的关键词仍作为参数，未知过滤列仍被拒绝', async () => {
        const result = await dyn.selectList(searchMeta, {
          filters: { views: ['eq', 1] },
          q: "' OR 1=1 --",
        });
        expect(result.rows).toEqual([]);
        expect(result.total).toBe(0);
        await expect(
          dyn.selectList(searchMeta, { filters: { evil: ['eq', 1] }, q: 'needle' }),
        ).rejects.toThrow(/字段不存在/);
      });
    });

    it('datetime 字段多格式归一为 ISO8601（ISO8601 / SQLite 原生 / Unix 秒 / 毫秒 / 无法解析原样返回）', async () => {
      // 基础数据见 beforeEach（3 行）：
      //   id=1: '2024-01-01T00:00:00Z'  → ISO8601
      //   id=3: '2024-01-03 10:00:00'    → SQLite 原生，按 UTC 拼 Z
      const r3 = await dyn.selectList(meta(), { filters: { id: ['eq', 3] } });
      expect(r3.rows[0]!.created_at).toBe('2024-01-03T10:00:00.000Z');
      const r1 = await dyn.selectList(meta(), { filters: { id: ['eq', 1] } });
      expect(r1.rows[0]!.created_at).toBe('2024-01-01T00:00:00.000Z');

      // 追加 Unix 秒 / 毫秒 / 无法解析 三种
      const ins = dbs.businessRaw.prepare(
        'INSERT INTO posts (title, views, created_at) VALUES (?, ?, ?)',
      );
      ins.run('sec', 0, '1700000000'); // Unix 秒（< 1e12）
      ins.run('ms', 0, '1700000000000'); // Unix 毫秒（> 1e12）
      ins.run('garbage', 0, 'not-a-date');

      const idSec = dbs.businessRaw.prepare('SELECT id FROM posts WHERE title=?').get('sec') as {
        id: number;
      };
      const idMs = dbs.businessRaw.prepare('SELECT id FROM posts WHERE title=?').get('ms') as {
        id: number;
      };
      const idBad = dbs.businessRaw.prepare('SELECT id FROM posts WHERE title=?').get('garbage') as {
        id: number;
      };

      const sec = (await dyn.selectOne(meta(), idSec.id))!.created_at;
      const ms = (await dyn.selectOne(meta(), idMs.id))!.created_at;
      const bad = (await dyn.selectOne(meta(), idBad.id))!.created_at;
      // 1700000000s = 2023-11-14T22:13:20.000Z
      expect(sec).toBe('2023-11-14T22:13:20.000Z');
      expect(ms).toBe('2023-11-14T22:13:20.000Z');
      expect(bad).toBe('not-a-date'); // 无法解析原样返回
    });
  });

  describe('selectOne', () => {
    it('按主键取一条', async () => {
      const row = await dyn.selectOne(meta(), 2);
      expect(row?.title).toBe('b');
    });
    it('不存在返回 undefined', async () => {
      expect(await dyn.selectOne(meta(), 999)).toBeUndefined();
    });
  });

  describe('insertRow / updateRow / deleteRow', () => {
    it('insert 返回新主键', async () => {
      const id = await dyn.insertRow(meta(), { title: 'x', views: 0 });
      expect(id).toBe(4);
    });
    it('update 改字段', async () => {
      await dyn.updateRow(meta(), 1, { views: 100 });
      const row = await dyn.selectOne(meta(), 1);
      expect(row?.views).toBe(100);
    });
    it('delete', async () => {
      await dyn.deleteRow(meta(), 1);
      expect(await dyn.selectOne(meta(), 1)).toBeUndefined();
    });
  });

  describe('incrementField', () => {
    it('integer 自增', async () => {
      await dyn.incrementField(meta(), 1, 'views', 3);
      expect((await dyn.selectOne(meta(), 1))?.views).toBe(8);
    });
  });

  describe('白名单（防注入）', () => {
    it('filters 中未知列名被拒', async () => {
      await expect(dyn.selectList(meta(), { filters: { evil: ['eq', 1] } })).rejects.toThrow(
        /VALIDATION_FAIL|字段不存在/,
      );
    });
    it('非法排序字段被拒', async () => {
      await expect(dyn.selectList(meta(), { order: 'evil:asc' })).rejects.toThrow(
        /VALIDATION_FAIL|字段不存在/,
      );
    });
  });
});
