/**
 * 聊天"连发多条"（气泡切分）—— 2026/9/19
 *
 * 为什么要有这一层：
 *   模型一次生成的是一整段，人聊天是一句一句发的。
 *   切分只发生在渲染层，模型仍然只请求一次；切出来的结果必须逐条落库。
 *
 * 2026/9/20 节奏：思考自动展开 → 想完收起 → 再一条一条往外冒。
 *
 * ═══ 2026/9/22 修「最后一个气泡变成垃圾桶」═══
 *
 * 真实问题（用户截图 + 复盘）：
 *   旧逻辑把「最多 4 条」当**硬上限** —— 切到第 4 条就再也不切了，
 *   剩下没说完的整段全部塞进最后一条。于是前三条短短、第四条特别长，
 *   读起来不像聊天，像按条数配额发消息。
 *
 * 现在两条原则：
 *   ① 条数不是配额：内容短就 1 条，内容多自然多发几条，不为了凑数硬拆。
 *   ② 只在自然停顿处断；她自己打的换行和（动作）永远照办。
 *
 * ═══ 2026/9/22 再修：切分不许"掐住她的嘴" ═══
 *
 * 部署方反馈：约束太紧时，她本来想说的整段会被句数硬卡住，
 * 明明需要写长的地方一下被砍掉，像被按着安排说话。
 *
 * 所以这里**绝不写"必须几句"**，也**不做"按字数硬裁"**：
 *   对话太长时她本来就会自己在句号处断开；万一她真写了一个超长句，
 *   那也是她的意思，宁可让她说完，也不替她砍成几截。
 * 上限只是防"整段 800 字刷屏"这种病态输入。
 *
 * 一个容易踩的坑：切分必须"边收边切"和"一次性切完"结果一模一样，
 * 否则屏幕上看到的和刷新之后的会变成两种样子。所以这里只用一个从左到右
 * 扫描的贪心规则 —— 快慢两种切法必然同解。
 */

const MIN_BUBBLE_CHARS = 5;

/** 普通回复一般不超过这么多条（内容真的多会自然增加） */
export const MAX_BUBBLES = 5;

/** 一条气泡最少攒到这么多字，才允许在标点处断开 */
const BASE_CUT_MIN = 12;

/** 说了几条之后门槛慢慢抬高 —— 话多时不会碎成十几条 */
const GROW_AFTER = 4;
const GROW_STEP = 6;
const MAX_CUT_MIN = 48;

/** 她自己打的换行、（动作）：门槛很低，因为那是她明确要断开 */
const EXPLICIT_MIN = 4;

/**
 * 一条气泡长到这样才"想办法"断开。
 * ★ 注意：这只在**找不到任何自然停顿**时才用来找断点，
 *   绝不用来给她的话硬裁长度 —— 她自己写的长句可以原样发出去。
 */
const MAX_BUBBLE_CHARS = 120;

/** 安全阀：再长也不超过这么多条，防止一条回复刷屏 */
const HARD_MAX_BUBBLES = 20;

/** 一整串连停顿都没有、还超过这么多字：才允许硬分（防刷屏），否则原样发 */
const HARD_SPLIT_CHARS = 300;

const TIER_EXPLICIT = 0; // 她自己打的换行 /（动作）—— 最高优先级
const TIER_SENTENCE = 1; // 。！？
const TIER_WEAK = 2;     // ，～… 表情

const SENTENCE_END = /[。！？!?]/;
const SOFT_END = /[…～~]/;
const TRAILING = /["'”’」』）)\]】]/;
const ACTION_HEAD = /^（[^）]{1,30}）|^\([^)]{1,30}\)/;
const ACTION_ANY = /（[^）]{1,30}）|\([^)]{1,30}\)/;

/**
 * 所有可以断开的位置，带优先级。
 * 括号内部不切 —— 动作描写不能被劈成两半。
 */
function cutCandidates(buffer) {
  const out = [];
  const add = (index, tier) => {
    if (index > 0 && index < buffer.length) out.push({ index, tier });
  };

  const head = buffer.match(ACTION_HEAD);
  if (head && buffer.slice(head[0].length).trim()) add(head[0].length, TIER_EXPLICIT);

  const nl = buffer.indexOf('\n');
  if (nl >= 0) add(nl + 1, TIER_EXPLICIT);

  const midAction = buffer.search(ACTION_ANY);
  if (midAction > 0) add(midAction, TIER_EXPLICIT);

  let depth = 0;
  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i];
    if (ch === '（' || ch === '(') { depth += 1; continue; }
    if (ch === '）' || ch === ')') { if (depth > 0) depth -= 1; continue; }
    if (depth > 0) continue;

    if (SENTENCE_END.test(ch)) {
      let end = i + 1;
      while (end < buffer.length && SENTENCE_END.test(buffer[end])) end += 1;
      while (end < buffer.length && TRAILING.test(buffer[end])) end += 1;
      add(end, TIER_SENTENCE);
      i = end - 1;
      continue;
    }
    if (SOFT_END.test(ch)) {
      let end = i + 1;
      while (end < buffer.length && SOFT_END.test(buffer[end])) end += 1;
      add(end, TIER_WEAK);
      i = end - 1;
      continue;
    }
    if (ch === '，'
      && buffer.slice(0, i).trim().length >= 8
      && buffer.slice(i + 1).trim().length >= 6) {
      add(i + 1, TIER_WEAK);
    }
  }

  const emojiCut = findEmojiCut(buffer);
  if (emojiCut > 0) add(emojiCut, TIER_WEAK);

  // 空格：她偶尔写英文或夹空格，长句里也能靠它断开
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === ' '
      && buffer.slice(0, i).trim().length >= 10
      && buffer.slice(i + 1).trim().length >= 6) {
      add(i + 1, TIER_WEAK);
    }
  }

  return out.sort((a, b) => a.index - b.index);
}

function usableCandidates(buffer, minChars) {
  return cutCandidates(buffer).filter((c) => (
    buffer.slice(0, c.index).trim().length >= minChars
    && buffer.slice(c.index).trim().length > 0
  ));
}

/** 门槛随条数缓慢抬高：话少时正常节奏，话多时自然变长（上限防止大段） */
function cutMinChars(emitted) {
  return Math.min(
    MAX_CUT_MIN,
    BASE_CUT_MIN + Math.max(0, emitted - GROW_AFTER + 1) * GROW_STEP,
  );
}

/**
 * 这一刀切在哪里 —— 从左往右的贪心规则，快慢两种切法必然同解。
 *
 *   1. 她自己打的换行、写的（动作）：只要前面够长，立刻照办。
 *   2. 句末（。！？）：攒够当前门槛之后的**第一个**句末就断 —— 那是一个完整意思。
 *   3. 整段已经很长还没句末：才退而用逗号/波浪号/表情断。
 *   4. 连一个停顿都没有的超长串：才按长度断（防刷屏）。
 *
 * ★ 关键：断点永远来自**她自己写的标点**，从不按"必须几句"硬裁。
 */
function nextCut(buffer, emitted) {
  if (emitted >= HARD_MAX_BUBBLES) return -1;

  const explicit = usableCandidates(buffer, EXPLICIT_MIN).find((c) => c.tier === TIER_EXPLICIT);
  if (explicit) return explicit.index;

  const minChars = cutMinChars(emitted);
  const cands = usableCandidates(buffer, minChars);
  if (!cands.length) {
    return buffer.trim().length > MAX_BUBBLE_CHARS ? MAX_BUBBLE_CHARS : -1;
  }

  const sentence = cands.find((c) => c.tier === TIER_SENTENCE);
  if (sentence && sentence.index <= MAX_BUBBLE_CHARS) return sentence.index;

  if (buffer.trim().length > MAX_BUBBLE_CHARS) {
    // 太长时优先在她自己的停顿处断（逗号/波浪号/表情/空格），不硬裁
    const weakAll = cands.filter((c) => c.tier === TIER_WEAK);
    if (weakAll.length) {
      const within = weakAll.filter((c) => c.index <= MAX_BUBBLE_CHARS);
      return within.length ? within[within.length - 1].index : weakAll[0].index;
    }
    // 连一个停顿都没有（病态超长句）：只能按长度断开，避免整段刷屏
    return MAX_BUBBLE_CHARS;
  }

  if (sentence) return sentence.index;
  return -1;
}

/**
 * 收尾剩下的内容：分成 n 条**差不多长**的，绝不整段甩到最后一条。
 * 优先在她自己的停顿处下刀；实在没有停顿才按长度硬分。
 */
function splitInto(text, n) {
  const t = String(text ?? '').trim();
  if (!t) return [];
  const count = Math.max(1, Math.round(n));
  if (count === 1) return [t];

  const cands = cutCandidates(t).filter((c) => (
    t.slice(0, c.index).trim().length >= MIN_BUBBLE_CHARS
    && t.slice(c.index).trim().length >= MIN_BUBBLE_CHARS
  ));
  const strong = cands.filter((c) => c.tier !== TIER_WEAK);
  const pool = strong.length ? strong : cands;

  // 找不到任何自然停顿：原样返回。宁可让她说完，也不替她砍成几截。
  // （只有病态超长输入才硬分，防止一条刷屏到没法看）
  if (!pool.length) {
    if (t.length <= HARD_SPLIT_CHARS) return [t];
    const n = Math.ceil(t.length / HARD_SPLIT_CHARS);
    const out = [];
    for (let i = 0; i < n; i++) {
      const piece = t.slice(
        Math.round((t.length * i) / n),
        Math.round((t.length * (i + 1)) / n),
      ).trim();
      if (piece) out.push(piece);
    }
    return out;
  }

  const chosen = [];
  for (let k = 1; k < count; k++) {
    const target = (t.length * k) / count;
    let bestIndex = -1;
    let bestDist = Infinity;
    for (const c of pool) {
      if (chosen.length && c.index <= chosen[chosen.length - 1]) continue;
      const d = Math.abs(c.index - target);
      if (d < bestDist) { bestDist = d; bestIndex = c.index; }
    }
    if (bestIndex > 0) chosen.push(bestIndex);
  }
  if (!chosen.length) return [t];

  chosen.sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const idx of chosen) {
    out.push(t.slice(prev, idx).trim());
    prev = idx;
  }
  out.push(t.slice(prev).trim());
  return out.filter((piece) => piece.length > 0);
}

function findEmojiCut(buffer) {
  const emoji = /\p{Extended_Pictographic}/gu;
  let match;
  while ((match = emoji.exec(buffer))) {
    const after = match.index + match[0].length;
    let end = after;
    while (end < buffer.length && (buffer[end] === ' ' || buffer[end] === '\uFE0F' || buffer[end] === '\u200D')) end += 1;
    if (buffer.slice(0, match.index).trim().length >= 6 && buffer.slice(end).trim().length >= 4) return end;
  }
  return -1;
}

export function createBubbleSplitter() {
  let buffer = '';
  let emitted = 0;
  const drain = () => {
    const ready = [];
    for (;;) {
      const cut = nextCut(buffer, emitted);
      if (cut <= 0 || cut >= buffer.length) break;
      ready.push(buffer.slice(0, cut).trim());
      emitted += 1;
      buffer = buffer.slice(cut);
    }
    return ready;
  };
  return {
    push(chunk) {
      buffer += String(chunk ?? '');
      return drain();
    },
    pending() {
      return buffer;
    },
    flush() {
      const ready = drain();
      const rest = buffer.trim();
      buffer = '';
      if (!rest) return ready;

      /**
       * ★ 2026/9/22：这里以前会"均衡分配"剩下的话 —— 那等于替她决定
       *   "你这段话得分成几条"，又是一种掐脖子。
       *
       * 现在：她没断，就不替她断。留到收尾的这一截，本来就已经是
       * "最后一个句号之后还没说完的尾巴"，通常很短，直接发出去就好。
       * 只有它长到明显不合理（比如一大段完全没标点），才在自然停顿处分一次。
       */
      if (rest.length <= MAX_BUBBLE_CHARS) return [...ready, rest];
      const avg = ready.length
        ? ready.reduce((sum, piece) => sum + piece.length, 0) / ready.length
        : BASE_CUT_MIN;
      const budget = Math.max(1, HARD_MAX_BUBBLES - ready.length);
      const want = Math.max(1, Math.round(rest.length / Math.max(1, avg)));
      const pieces = splitInto(rest, Math.min(want, budget));
      return [...ready, ...(pieces.length ? pieces : [rest])];
    },
  };
}

export function splitReplyIntoBubbles(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return [];
  const splitter = createBubbleSplitter();
  return [...splitter.push(raw), ...splitter.flush()];
}

export function isActionBubble(text) {
  const t = String(text || '').trim();
  return /^（[^）]{1,30}）$/.test(t) || /^\*[^*]{1,40}\*$/.test(t);
}

export function firstBubbleId(replyId) {
  return String(replyId) + '_0';
}

export function isBubbleInTurn(messageId, replyId) {
  return String(messageId || '').startsWith(String(replyId) + '_');
}

function sameSpeakerGroup(prev, curr) {
  if (!prev || !curr) return false;
  if (prev.type === 'time' || curr.type === 'time') return false;
  return prev.who === curr.who;
}

export function annotateConsecutiveGroups(messages) {
  const visible = [];
  const indexMap = [];
  (messages || []).forEach((m, i) => {
    if (m?._holdBody && !m.think && !m.reasoningRequested) return;
    visible.push(m);
    indexMap.push(i);
  });
  const groupedVisible = visible.map((m, i, list) => {
    if (!m || m.type === 'time') {
      return { ...m, _continue: false, _hideAvatar: false, _lastInGroup: true };
    }
    const continueFromPrev = sameSpeakerGroup(list[i - 1], m);
    const continueToNext = sameSpeakerGroup(m, list[i + 1]);
    return {
      ...m,
      _continue: continueFromPrev,
      _hideAvatar: continueFromPrev,
      _lastInGroup: !continueToNext,
    };
  });
  const out = (messages || []).map((m) => ({ ...m, _continue: false, _hideAvatar: false, _lastInGroup: true }));
  groupedVisible.forEach((gm, i) => { out[indexMap[i]] = gm; });
  return out;
}

export function applyTurnReasoning(messages, replyId, {
  think = '',
  requested = false,
  pending = false,
  unavailable = false,
  streaming = null,
} = {}) {
  const firstId = firstBubbleId(replyId);
  return (messages || []).map((m) => {
    if (!isBubbleInTurn(m._id, replyId)) return m;
    const isFirst = m._id === firstId;
    return {
      ...m,
      ...(streaming === null ? {} : { _streaming: Boolean(streaming) }),
      think: isFirst ? think : '',
      reasoningRequested: isFirst && requested,
      reasoningPending: isFirst && pending,
      reasoningUnavailable: isFirst && unavailable,
    };
  });
}

export default {
  createBubbleSplitter,
  splitReplyIntoBubbles,
  MAX_BUBBLES,
  isActionBubble,
  firstBubbleId,
  isBubbleInTurn,
  annotateConsecutiveGroups,
  applyTurnReasoning,
};
