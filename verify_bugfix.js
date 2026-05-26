/**
 * 若白项目 Bug 修复验证脚本
 * 
 * 用法：在项目根目录运行 node verify_bugfix.js
 * 
 * 输出 ✅ PASS 或 ❌ FAIL，你只需要看有没有 FAIL
 * 全部 PASS = Codex 做对了
 * 有 FAIL = 告诉 Claude 哪些 FAIL 了
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;

function check(name, condition, detail) {
  if (condition) {
    console.log(`✅ PASS: ${name}`);
    passed++;
  } else {
    console.log(`❌ FAIL: ${name}`);
    if (detail) console.log(`   原因: ${detail}`);
    failed++;
  }
}

function readFile(relPath) {
  try {
    return fs.readFileSync(path.join(__dirname, relPath), 'utf-8');
  } catch {
    return null;
  }
}

// ========== BUG-1: memory.js include_deleted ==========
const serverMemory = readFile('server/memory.js');
if (serverMemory) {
  // 不应该还有 is_deleted = ? 这种简单等于的写法
  const hasBadQuery = /is_deleted\s*=\s*\?/.test(serverMemory) && 
                      !/(is_deleted\s*=\s*0|OR)/.test(serverMemory);
  check('BUG-1: memory.js include_deleted 修复', 
    !hasBadQuery,
    '仍然使用 is_deleted = ? 的错误逻辑');
  
  // 应该有某种"不过滤deleted"的条件
  const hasCorrectLogic = /includeDeleted|include_deleted/i.test(serverMemory) &&
    (/is_deleted\s*=\s*0/.test(serverMemory) || /OR/.test(serverMemory) || /whereDeletedClause|deletedFilter/i.test(serverMemory));
  check('BUG-1: 正确的 include_deleted 逻辑',
    hasCorrectLogic,
    '没有找到正确的条件过滤逻辑');
} else {
  check('BUG-1: server/memory.js 文件存在', false, '文件不存在');
}

// ========== BUG-2: memory.js intimacyDash null check ==========
const frontMemory = readFile('public/js/memory.js');
if (frontMemory) {
  const intimacySection = frontMemory.substring(
    frontMemory.indexOf('function intimacyDash'),
    frontMemory.indexOf('function intimacyDash') + 300
  );
  const hasNullCheck = /if\s*\(\s*!c\s*\)/.test(intimacySection) || 
                       /c\s*\?\?/.test(intimacySection) ||
                       /c\s*&&/.test(intimacySection) ||
                       /if\s*\(\s*!getCurrentChar/.test(intimacySection);
  check('BUG-2: intimacyDash 空值检查',
    hasNullCheck,
    'getCurrentChar() 返回空时仍会崩溃');
} else {
  check('BUG-2: public/js/memory.js 文件存在', false, '文件不存在');
}

// ========== BUG-4: posts.js 删除前验证归属 ==========
const serverPosts = readFile('server/posts.js');
if (serverPosts) {
  const deleteSection = serverPosts.substring(
    serverPosts.indexOf("router.delete('/:id'"),
    serverPosts.indexOf("router.delete('/:id'") + 800
  );
  // 应该在 DELETE FROM post_likes 之前有一个 SELECT 验证
  const selectIdx = deleteSection.indexOf('SELECT');
  const deleteLikesIdx = deleteSection.indexOf('DELETE FROM post_likes');
  
  check('BUG-4: 删除帖子前先验证归属',
    selectIdx > -1 && deleteLikesIdx > -1 && selectIdx < deleteLikesIdx,
    '应该先 SELECT 验证帖子归属，再删除点赞/评论');
} else {
  check('BUG-4: server/posts.js 文件存在', false, '文件不存在');
}

// ========== BUG-5: memory 排序 ==========
if (frontMemory) {
  const hasBadSort = /\.time\.localeCompare/.test(frontMemory);
  check('BUG-5: 记忆排序不再用中文日期字符串',
    !hasBadSort,
    '仍在用 .time.localeCompare 做排序');
  
  const hasGoodSort = /created_at|createdAt|getTime|Date/.test(
    frontMemory.substring(
      frontMemory.indexOf('displayedMemories'),
      frontMemory.indexOf('displayedMemories') + 500
    )
  );
  check('BUG-5: 记忆排序使用时间戳',
    hasGoodSort,
    '没有找到基于时间戳的排序逻辑');
}

// ========== BUG-6: server.js 路由顺序 ==========
const serverMain = readFile('server/server.js');
if (serverMain) {
  const errorHandlerIdx = serverMain.indexOf('(error, _req, res, _next)');
  const catchAllIdx = serverMain.indexOf("app.get('*'");
  
  check('BUG-6: catch-all 在错误处理之前',
    catchAllIdx > -1 && errorHandlerIdx > -1 && catchAllIdx < errorHandlerIdx,
    'app.get("*") 应该在 error handler 之前');
} else {
  check('BUG-6: server/server.js 文件存在', false, '文件不存在');
}

// ========== BUG-7: components.js bindNav 选择器 ==========
const components = readFile('public/js/components.js');
if (components) {
  const hasTooWideSelector = /querySelectorAll\s*\(\s*'\[data-char\]'\s*\)/.test(components);
  check('BUG-7: bindNav 不再用过宽的 [data-char] 选择器',
    !hasTooWideSelector,
    '仍然绑定所有 [data-char] 元素');
} else {
  check('BUG-7: public/js/components.js 文件存在', false, '文件不存在');
}

// ========== BUG-9: chat.js 流式错误处理 ==========
const serverChat = readFile('server/chat.js');
if (serverChat) {
  // 找流式代理部分是否有 try/catch 包裹 for await
  const hasStreamErrorHandling = /catch\s*\(.*\)\s*\{[\s\S]*?(流中断|stream|writableEnded)/i.test(serverChat) ||
    /try\s*\{[\s\S]*?for\s+await/.test(serverChat);
  check('BUG-9: AI流式代理有错误处理',
    hasStreamErrorHandling,
    '流式代理的 for await 循环缺少 try/catch');
} else {
  check('BUG-9: server/chat.js 文件存在', false, '文件不存在');
}

// ========== 语法检查 ==========
import { execSync } from 'child_process';

const jsFiles = [
  ...fs.readdirSync(path.join(__dirname, 'server')).filter(f => f.endsWith('.js')).map(f => `server/${f}`),
  ...fs.readdirSync(path.join(__dirname, 'public/js')).filter(f => f.endsWith('.js')).map(f => `public/js/${f}`)
];

let syntaxErrors = [];
for (const f of jsFiles) {
  try {
    execSync(`node --check ${path.join(__dirname, f)}`, { encoding: 'utf-8', stdio: 'pipe' });
  } catch {
    syntaxErrors.push(f);
  }
}

check('语法检查: 所有JS文件无语法错误',
  syntaxErrors.length === 0,
  `以下文件有语法错误: ${syntaxErrors.join(', ')}`);

// ========== 总结 ==========
console.log('\n' + '='.repeat(50));
console.log(`总计: ${passed} PASS, ${failed} FAIL`);
if (failed === 0) {
  console.log('🎉 全部通过！Bug 修复验证成功！');
} else {
  console.log(`⚠️ 有 ${failed} 项未通过，请把这个输出发给 Claude 检查`);
}
console.log('='.repeat(50));
