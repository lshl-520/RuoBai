import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/*
 * 为什么要有这条测试（2026/10/14 真机事故）：
 *
 * App 是「手机本地壳」——界面从手机本地加载，跑在 https://localhost 上，
 * 只有 /api/ 和 /user_assets/ 需要连服务器。
 *
 * 所以写成相对路径的 '/user_assets/...' 在浏览器里正常（同源），
 * 在 App 里却会被解析成 https://localhost/user_assets/... → 文件不存在 → 裂图。
 * 自定义立绘 / 头像必须统一经过 assetUrl()，由它补上服务器域名。
 * 当时角色页自己写了一份取图函数、直接 return customUrl，角色页的立绘全裂了。
 */
const agents = fs.readFileSync(new URL('./pages/agents.jsx', import.meta.url), 'utf8');
const roles = fs.readFileSync(new URL('./lib/roles.js', import.meta.url), 'utf8');
const live2d = fs.readFileSync(new URL('./lib/live2d.js', import.meta.url), 'utf8');
const apiBase = fs.readFileSync(new URL('./lib/api-base.js', import.meta.url), 'utf8');
const chat = fs.readFileSync(new URL('./pages/chat.jsx', import.meta.url), 'utf8');
const moments = fs.readFileSync(new URL('./pages/moments.jsx', import.meta.url), 'utf8');
const profile = fs.readFileSync(new URL('./pages/profile.jsx', import.meta.url), 'utf8');

test('assetUrl 会给 App 里的 /user_assets/ 和 /api/ 补上服务器域名', () => {
  assert.ok(apiBase.includes('export function assetUrl'));
  assert.ok(apiBase.includes('/^\\/user_assets\\//'), 'assetUrl 应识别 /user_assets/');
  assert.ok(apiBase.includes('/^\\/api\\//'), 'assetUrl 应识别 /api/');
  assert.ok(apiBase.includes('return apiUrl(raw)'), 'assetUrl 应把相对路径转成完整地址');
});

test('角色页的立绘走公共取图函数，不再自己拼路径', () => {
  assert.match(agents, /import \{[^}]*getRoleFullPortrait[^}]*\} from "\.\.\/lib\/roles\.js"/);
  assert.match(agents, /cover: getRoleFullPortrait\(role\)/);
  assert.doesNotMatch(agents, /function getFullPortrait/);
  assert.doesNotMatch(agents, /return customUrl;/);
});

test('所有角色取图函数都会给自定义立绘补域名', () => {
  const wrapped = roles.match(/return assetUrl\(customUrl\);/g) || [];
  assert.ok(wrapped.length >= 3, 'expected >=3 assetUrl(customUrl) wrappers, got ' + wrapped.length);
  assert.doesNotMatch(roles, /return customUrl;/);
  const previews = roles.match(/return assetUrl\(visualPreview\);/g) || [];
  assert.ok(previews.length >= 3, 'expected >=3 assetUrl(visualPreview) wrappers, got ' + previews.length);
});

test('聊天里的图片 / 语音 / 贴纸 / 待发缩略图都走 assetUrl（App 里才看得见）', () => {
  assert.ok(chat.includes('import { assetUrl } from "../lib/api-base.js";'), 'chat.jsx 应引入 assetUrl');
  assert.ok(chat.includes('<img src={assetUrl(src)} alt="聊天图片"'), '聊天图片缩略图要补域名');
  assert.ok(chat.includes('onOpenImage?.(assetUrl(src))'), '点开大图要补域名');
  assert.ok(chat.includes('<img src={assetUrl(src)} alt="聊天图片原图"'), '大图预览要补域名');
  assert.ok(chat.includes('saveChatImage(assetUrl(src))'), '保存图片要补域名');
  assert.ok(chat.includes('src={assetUrl(m.audioUrl)}'), '语音要补域名');
  assert.ok(chat.includes('src={assetUrl(stickerImg)}'), '贴纸要补域名');
  assert.ok(chat.includes('src={assetUrl(myAvatar)}'), '我自己的头像要补域名');
});

test('动态与我的页面里，我自己的头像也走 assetUrl', () => {
  assert.ok(moments.includes('assetUrl(user.avatar)'), '动态页我的头像要补域名');
  assert.ok(moments.includes('assetUrl(m.avatar)'), '动态条目头像要补域名');
  assert.ok(profile.includes('import { assetUrl } from "../lib/api-base.js";'), 'profile.jsx 应引入 assetUrl');
  assert.ok(profile.includes('src={assetUrl(pic)}'), '我的页头像要补域名');
  assert.ok(profile.includes('src={assetUrl(avatar)}'), '我的页大图要补域名');
});

test('Live2D 运行库地址不写死相对路径，并且会补服务器域名', () => {
  assert.ok(!live2d.includes('/user_assets/live2d-runtime'), 'live2d 不应写死相对路径');
  assert.ok(live2d.includes('VITE_RUOBAI_LIVE2D_CORE_URL'), 'live2d 应读构建期环境变量');
  assert.ok(live2d.includes('assetUrl(configured.trim())'), '全局注入的地址要补域名');
  assert.ok(live2d.includes('assetUrl(envUrl.trim())'), '环境变量里的地址要补域名');
});

test('角色编辑页的自己传的立绘（预览 + 缩略图）也走 assetUrl', () => {
  assert.ok(agents.includes('import { assetUrl } from "../lib/api-base.js";'), 'agents.jsx 应引入 assetUrl');
  assert.ok(agents.includes('<div className="portrait-preview"><img src={assetUrl(portrait)} alt="" /></div>'), '立绘预览要补域名');
  assert.ok(agents.includes('<img src={assetUrl(u)} alt="" />'), '自定义立绘缩略图要补域名');
  assert.ok(!agents.includes('<img src={u} alt="" />'), '缩略图不能再用裸地址');
});