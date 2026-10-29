import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const initDbSource = await fs.readFile(new URL('./init-db.js', import.meta.url), 'utf8');
const serverSource = await fs.readFile(new URL('./server.js', import.meta.url), 'utf8');
const composeSource = await fs.readFile(new URL('../deploy/docker-compose.yml', import.meta.url), 'utf8');
const installScriptSource = await fs.readFile(new URL('../scripts/install-docker.sh', import.meta.url), 'utf8');
const readmeSource = await fs.readFile(new URL('../README.md', import.meta.url), 'utf8');

test('★ 管理员初始密码不再写死（公开仓库安全底线）', () => {
  // 2026/10/30：旧版写死 admin/123456，仓库公开后等于后台没锁。
  assert.doesNotMatch(initDbSource, /DEFAULT_ADMIN_PASSWORD/);
  assert.doesNotMatch(initDbSource, /'123456'/);
  assert.match(initDbSource, /ADMIN_INITIAL_PASSWORD/);
  assert.match(initDbSource, /randomBytes/);
  assert.doesNotMatch(serverSource, /123456/, '启动横幅不许再打印写死的初始密码');
});

test('★ Docker 部署把管理员初始密码从安装脚本传进容器', () => {
  assert.match(composeSource, /ADMIN_INITIAL_PASSWORD/);
  assert.match(installScriptSource, /ADMIN_INITIAL_PASSWORD=/);
  assert.doesNotMatch(installScriptSource, /DEFAULT_ADMIN_PASSWORD/);
  assert.doesNotMatch(installScriptSource, /123456/);
});

test('★ 部署文档的首选命令是 git clone + 本地脚本（raw 在国内打不开）', () => {
  assert.match(readmeSource, /bash scripts\/install-docker\.sh/);
});

test('init-db schema avoids MySQL TEXT columns with DEFAULT values', () => {
  assert.doesNotMatch(initDbSource, /\bTEXT\s+DEFAULT\b/i);
});

test('init-db schema avoids ADD COLUMN IF NOT EXISTS for older MariaDB', () => {
  assert.doesNotMatch(initDbSource, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/i);
});

test('init-db schema falls back when AFTER anchor columns are missing', () => {
  assert.match(initDbSource, /existingColumns\.has\(fixup\.after\)/);
  assert.match(initDbSource, /ALTER TABLE \$\{fixup\.table\} ADD COLUMN \$\{fixup\.column\}/);
});

test('init-db schema backfills legacy columns used by the previous deployment', () => {
  assert.match(initDbSource, /personality/);
  assert.match(initDbSource, /base_url/);
  assert.match(initDbSource, /model_name/);
});

test('init-db schema backfills moments images column for older deployments', () => {
  assert.match(
    initDbSource,
    /table:\s*'moments'[\s\S]*column:\s*'images'[\s\S]*definition:\s*'JSON'/
  );
  assert.match(
    initDbSource,
    /table:\s*'moments'[\s\S]*column:\s*'likes_count'[\s\S]*definition:\s*'INT DEFAULT 0'/
  );
  assert.match(
    initDbSource,
    /table:\s*'moments'[\s\S]*column:\s*'is_deleted'[\s\S]*definition:\s*'TINYINT\(1\) DEFAULT 0'/
  );
});

test('init-db schema allows personal moments without a character', () => {
  assert.match(initDbSource, /character_id INT DEFAULT NULL/);
  assert.match(
    initDbSource,
    /ALTER TABLE `?\$\{fixup\.table\}`? MODIFY COLUMN `?\$\{fixup\.column\}`? \$\{fixup\.definition\}/
  );
});


test('characters schema stores a dedicated chat model and thinking level per role', () => {
  assert.match(initDbSource, /chat_credential_id INT DEFAULT NULL/);
  assert.match(initDbSource, /chat_model_id VARCHAR\(100\) DEFAULT NULL/);
  assert.match(initDbSource, /chat_thinking_level VARCHAR\(20\) DEFAULT 'off'/);
});

test('characters schema keeps automatic moment responses disabled by default', () => {
  assert.match(initDbSource, /moment_response_enabled TINYINT\(1\) DEFAULT 0/);
});

test('init-db stores non-sensitive automatic moment attempts for cooldown and diagnosis', () => {
  assert.match(initDbSource, /CREATE TABLE IF NOT EXISTS auto_moment_attempts/);
  assert.match(initDbSource, /outcome VARCHAR\(32\) NOT NULL DEFAULT 'planner_started'/);
  assert.match(initDbSource, /next_retry_at DATETIME DEFAULT NULL/);
  assert.doesNotMatch(initDbSource, /auto_moment_attempts[\s\S]{0,1200}(?:content|prompt)\s+(?:TEXT|JSON|VARCHAR)/i);
});
