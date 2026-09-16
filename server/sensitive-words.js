/**
 * ═══ 敏感词表加载器（2026/9/16）═══
 *
 * 背景：用户发现公开仓库的历史里出现过身体部位词，非常不安
 * （原话：「别人会想这个人靠聊性才发现的问题」）。
 *
 * 这些词**在产品逻辑上是必需的** —— 陪伴类 AI 必须能识别
 * "他是不是在聊这个话题"，也必须规定"哪些话该用、哪些不该用"。
 * 但它们不该出现在公开代码里：别人 clone 一搜就会误解这个项目的用途，
 * 而且那属于用户和角色之间的私人语境。
 *
 * 所以：**词表本体放 `sensitive-words.local.json`，不进仓库**（见 .gitignore）。
 * 本文件只负责"读它"，读不到就用一组**温和的**回退词，
 * 保证应用不崩、识别能力不归零。
 *
 * 部署：把 `sensitive-words.local.example.json` 复制成
 * `sensitive-words.local.json`，按自己的语言习惯填词即可。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_FILE = path.join(HERE, 'sensitive-words.local.json');

/**
 * 回退词表：故意**只保留温和的、日常也能出现的信号**。
 * 缺私有词表时，露骨内容会识别得差一些，但这正是开源默认该有的样子 ——
 * 每个部署方按自己的语境补词。
 */
const FALLBACK = Object.freeze({
  explicitBody: [],
  explicitAct: [],
  intimacyAsk: ['想要你', '想要我', '色色', '涩涩', '爱爱', '亲亲', '抱抱'],
  howto: [],
  contextAnchor: ['性', '身体', '那里', '下面', '床', '敏感'],
  euphemism: [],
  clinical: [],
  unsafeDailyVisual: ['内衣', '床上', '浴室', '洗澡', '私密', '敏感部位', '亲吻', '拥抱'],
});

const KEYS = ['explicitBody', 'explicitAct', 'intimacyAsk', 'howto', 'contextAnchor', 'euphemism', 'clinical', 'unsafeDailyVisual'];

let cached = null;

/** 读取词表（带缓存）。任何异常都退回 FALLBACK，绝不抛。 */
export function loadSensitiveWords() {
  if (cached) return cached;
  let fromFile = null;
  try {
    if (fs.existsSync(LOCAL_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object') fromFile = parsed;
    }
  } catch {
    fromFile = null;
  }
  const merged = {};
  for (const key of KEYS) {
    const list = fromFile?.[key];
    merged[key] = Array.isArray(list) && list.length
      ? list.map((w) => String(w || '').trim()).filter(Boolean)
      : [...FALLBACK[key]];
  }
  merged.hasLocalFile = Boolean(fromFile);
  cached = Object.freeze(merged);
  return cached;
}

/** 把词数组编成"命中任意一个"的正则；空数组返回 null。 */
export function wordsToRegex(words) {
  const escaped = (Array.isArray(words) ? words : [])
    .map((w) => String(w || '').trim())
    .filter(Boolean)
    // 长的排前面：避免短词先匹配吃掉长词
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!escaped.length) return null;
  return new RegExp(`(${escaped.join('|')})`, 'u');
}

/** 「命中任意一个即算」的便捷判断（词表为空时恒为 false）。 */
export function matchesAny(text, words) {
  const re = wordsToRegex(words);
  return re ? re.test(String(text || '')) : false;
}

export default { loadSensitiveWords, wordsToRegex, matchesAny };
