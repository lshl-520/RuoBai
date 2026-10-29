import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sortRolesLikeServer } from './lib/local-role-cache.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * ★ 2026/10/6：聊天列表顺序回归测试。
 *
 * 病根：手机 App 读本地缓存时，缓存按"最近写入"排（updated_at DESC），
 * 于是"谁最后被同步"而不是"谁是主陪伴"决定了谁在最上面 ——
 * 表现就是列表先显示一种顺序、再跳成另一种，用户的小白（id 48）被挤到最后。
 */
test('主陪伴永远排第一，其余按 id 升序', () => {
  const rows = [
    { id: 57, name: '宝', is_active: 0 },
    { id: 56, name: '晚晚', is_active: 0 },
    { id: 53, name: '小师', is_active: 0 },
    { id: 48, name: '小白', is_active: 1 },
  ];
  assert.deepEqual(
    sortRolesLikeServer(rows).map((r) => r.id),
    [48, 53, 56, 57],
  );
});

test('就算小白不是主陪伴，顺序也稳定为按 id（不再按"最近写入"乱跳）', () => {
  const rows = [
    { id: 61, is_active: 0 },
    { id: 48, is_active: 0 },
    { id: 53, is_active: 0 },
  ];
  assert.deepEqual(sortRolesLikeServer(rows).map((r) => r.id), [48, 53, 61]);
});

test('本地缓存不再用 updated_at 决定名次', () => {
  const source = fs.readFileSync(path.join(here, 'lib', 'local-role-cache.js'), 'utf8');
  // 只看真正的 SQL 语句，别把解释性注释也算进去
  const sqlLines = source
    .split('\n')
    .filter((line) => {
      const s = line.trim();
      return !s.startsWith('*') && !s.startsWith('//') && !s.startsWith('/*');
    })
    .join('\n');
  assert.doesNotMatch(
    sqlLines,
    /ORDER BY updated_at/,
    '缓存查询不能再按 updated_at 排序，否则列表会按"最近同步"跳',
  );
  assert.match(source, /sortRolesLikeServer/, '必须用和服务端一致的排序');
});

test('聊天列表渲染时主陪伴置顶', () => {
  const source = fs.readFileSync(path.join(here, 'pages', 'chat.jsx'), 'utf8');
  assert.match(
    source,
    /const displayList = \[\.\.\.list\]\.sort/,
    '聊天列表必须对主陪伴做置顶，不能直接 list',
  );
});
