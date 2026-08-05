import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const agentsSource = fs.readFileSync(new URL('./pages/agents.jsx', import.meta.url), 'utf8');
const modelsSource = fs.readFileSync(new URL('./pages/models.jsx', import.meta.url), 'utf8');
const chatSource = fs.readFileSync(new URL('./pages/chat.jsx', import.meta.url), 'utf8');

test('角色编辑页保存固定形象和生活模板，而不是要求用户写提示词', () => {
  assert.match(agentsSource, /auto_moments_image_profile:\s*auto \? imageProfile : null/);
  assert.match(agentsSource, /auto_moments_templates:\s*auto \? momentTemplates : null/);
  assert.match(agentsSource, /固定形象需要姓名和年龄感/);
  assert.match(agentsSource, /小白的动态生活|动态生活/);
  assert.doesNotMatch(agentsSource, /生图 Prompt/);
});

test('能力页明确分开聊天手动画图和自动动态发图', () => {
  assert.match(modelsSource, /dynamic:\s*\{\s*icon: "image", name: "动态发图"/);
  assert.match(modelsSource, /\{ key: "dynamic", icon: "image", label: "动态" \}/);
  assert.match(modelsSource, /“画图发图”是你在聊天里让她画.*“动态发图”只用于她自动发动态/);
});

test('动态模型选择失败不会被静默吞掉', () => {
  assert.match(modelsSource, /if \(!result\?\.success \|\| !result\?\.item\) throw new Error\(result\?\.error \|\| "模型保存失败"\)/);
  assert.match(modelsSource, /setCapError\(e\?\.message \|\| "模型保存失败"\)/);
  assert.match(modelsSource, /disabled=\{saving\}/);
});

test('角色编辑允许用户直接测试动态发图渠道，不等待聊天规划或冷却时间', () => {
  assert.match(agentsSource, /testAutoMoment\(agent\._raw\.id\)/);
  assert.match(agentsSource, /现在测试动态发图/);
  assert.match(agentsSource, /可能消耗一次额度/);
  assert.match(agentsSource, /跳过聊天判断/);
});

test('动态和手动画图都提供跟随渠道的清晰度选择', () => {
  assert.match(agentsSource, /auto_moments_image_resolution: auto && autoImages \? imageResolution : "channel"/);
  assert.match(agentsSource, /图片清晰度/);
  assert.match(agentsSource, /跟随渠道/);
  assert.match(chatSource, /这次图片清晰度/);
  assert.match(chatSource, /onSubmit\(\{ \.\.\.values, resolution \}\)/);
});
