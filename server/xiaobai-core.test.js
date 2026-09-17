import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INTENT,
  NEED,
  MOOD,
  SCENE,
  STANCE,
  buildXiaobaiCorePrompt,
  classifyIntent,
  deriveNextXiaobaiState,
  getStrategy,
  inferNeed,
  normalizeXiaobaiState,
  planReply,
  shouldRecallMemory,
  stickerGroupFor,
} from './xiaobai-core.js';

test('情感类消息先安抚，不急着解决问题', () => {
  // 带着问题说累：优先级必须是「先接情绪」，不能被当成提问
  assert.equal(classifyIntent({ content: '今天真的好累' }), INTENT.EMOTION);
  assert.equal(classifyIntent({ content: '我好烦啊，怎么办' }), INTENT.EMOTION);
  assert.equal(inferNeed(INTENT.EMOTION), NEED.COMFORT);

  const plan = planReply({ content: '我今天有点撑不住' });
  assert.match(plan.prompt, /先接住情绪/);
  assert.match(plan.prompt, /不要急着解决/);
  assert.match(plan.prompt, /心理分析|长篇安慰/);
});

test('「我不懂」优先于普通提问，且禁止说教', () => {
  assert.equal(classifyIntent({ content: '这个是什么意思？' }), INTENT.LEARN);
  assert.equal(classifyIntent({ content: '这个我忘了' }), INTENT.LEARN);
  assert.equal(classifyIntent({ content: '我以前是不是理解错了' }), INTENT.LEARN);
  // 「我不懂」这类句式里，只要**没有**性语境锚点，就老老实实归 LEARN。
  // 反面例子（带性语境 → DESIRE）在下面单独测。
  assert.equal(classifyIntent({ content: '我不会这个公式' }), INTENT.SELF_DOUBT);
  assert.equal(classifyIntent({ content: '这一步我没学过' }), INTENT.LEARN);

  const plan = planReply({ content: '这个我忘了' });
  assert.equal(plan.intent, INTENT.LEARN);
  assert.equal(plan.need, NEED.ANSWER);
  assert.match(plan.prompt, /直接从他现在的问题讲起/);
  assert.match(plan.prompt, /这个很基础|你之前不是问过/);
});

test('性语境里的「我不懂」归 DESIRE，不是普通求知', () => {
  // 这些句子在真实聊天里很常见：他在问一个刚听到的词，且场景在身体里。
  // 必须归 DESIRE —— 因为 DESIRE 铁律「不许推他去现实」要在这一轮生效，
  // 而且他真正要的是「用他能听懂的词讲清楚」，不是一段科普。
  assert.equal(classifyIntent({ content: '顶到花心是什么意思' }), INTENT.DESIRE);
  assert.equal(classifyIntent({ content: '我不会，那里的感觉怎么弄' }), INTENT.DESIRE);
  assert.equal(classifyIntent({ content: '第一次大概插多深合适' }), INTENT.DESIRE);
  assert.equal(classifyIntent({ content: '我不懂色色要怎么做' }), INTENT.DESIRE);

  const plan = planReply({ content: '顶到花心是什么意思' });
  assert.equal(plan.intent, INTENT.DESIRE);
  assert.match(plan.prompt, /不要把他推走/);
  // 清白信号：这一句里他没有自贬，不该走「我不嫌你」那条线
  assert.doesNotMatch(plan.prompt, /我不嫌/);
});

test('带亲密称谓的求教，走教他，不走安慰', () => {
  // 这一类句子的形状：没有身体词，但句末带上对伴侣的专属称谓 + 求教动词。
  // 该组合在亲密语境里只有一种指向。
  // 判错的话她会跑去说「我不嫌你」，而他要的是「怎么做」——那就是撕裂。
  // 样本只保留判定所依赖的**结构**（称谓 + 求教 / 语气词），不取自任何具体使用者。
  for (const content of [
    '我不会呀宝贝教我',
    '我不会，你教我嘛',
    '亲爱的教教我怎么做',
  ]) {
    assert.equal(classifyIntent({ content }), INTENT.DESIRE, `"${content}" 应归 DESIRE`);
  }
  assert.equal(classifyIntent({ content: '我没经验，第一次要注意什么' }), INTENT.DESIRE);

  const plan = planReply({ content: '我不会呀宝贝教我' });
  assert.equal(plan.need, NEED.GUIDANCE);
  assert.match(plan.prompt, /不要把他推走/);
  assert.doesNotMatch(plan.prompt, /我不嫌/);
});

test('分享好事时不会被「累」字误伤成情绪低落', () => {
  // 他爬完山会说「累死了但很爽」。这时候他要的是一起高兴，不是被安慰。
  const happy = planReply({ content: '今天爬了梧桐山，累死了但很爽' });
  assert.equal(happy.intent, INTENT.SHARE);
  assert.equal(happy.need, NEED.SHARE_BACK);
  assert.match(happy.prompt, /先回应这件具体的小事/);

  assert.equal(classifyIntent({ content: '今天加班到十点，累，不过搞完了还挺爽' }), INTENT.SHARE);
  assert.equal(classifyIntent({ content: '今天挺不错的' }), INTENT.SHARE);

  // 但真正的低落必须还是情绪 —— 不能因为加了正向词就把难受吞掉
  assert.equal(classifyIntent({ content: '今天好累，心里也难受' }), INTENT.EMOTION);
  // 「撑不住」是危险信号，优先级高于一切，不能被正向词盖住
  assert.equal(classifyIntent({ content: '累，但撑不住了' }), INTENT.SELF_HARM);
  // 「开心」不能盖住「想哭」
  assert.equal(classifyIntent({ content: '说不清，就是突然想哭' }), INTENT.EMOTION);
});

test('图片一律按分享处理，且不机械分析', () => {
  assert.equal(classifyIntent({ content: '', messageType: 'image' }), INTENT.SHARE);
  assert.equal(classifyIntent({ content: '看看这个', messageType: 'image' }), INTENT.SHARE);

  const plan = planReply({ content: '看看这个西瓜', messageType: 'image' });
  assert.match(plan.prompt, /先回应这件具体的小事/);
  assert.match(plan.prompt, /机械分析/);
});

test('短句撒娇按亲近处理，且只回一句', () => {
  assert.equal(classifyIntent({ content: '宝' }), INTENT.AFFECTION);
  assert.equal(classifyIntent({ content: '想你' }), INTENT.AFFECTION);
  assert.equal(classifyIntent({ content: '抱抱' }), INTENT.AFFECTION);
  assert.equal(inferNeed(INTENT.AFFECTION), NEED.COMPANY);

  const plan = planReply({ content: '想你了' });
  const s = getStrategy(INTENT.AFFECTION);
  assert.equal(s.maxSentences, 1);
  assert.match(plan.prompt, /1 句左右/);
});

test('夸奖自然接住，禁止否认和长篇感谢', () => {
  assert.equal(classifyIntent({ content: '你真好看' }), INTENT.PRAISE);
  assert.equal(classifyIntent({ content: '老婆好厉害' }), INTENT.PRAISE);

  const plan = planReply({ content: '你真好看' });
  assert.match(plan.prompt, /否认夸奖|长段感谢/);
});

test('吐槽时和他站一边，不劝大度', () => {
  assert.equal(classifyIntent({ content: '这也太离谱了' }), INTENT.TEASE);
  assert.equal(classifyIntent({ content: '笑死我了什么鬼' }), INTENT.TEASE);

  const plan = planReply({ content: '这也太离谱了' });
  assert.match(plan.prompt, /和他站一边/);
  assert.match(plan.prompt, /劝他大度|说教/);
});

test('普通提问直接回答，不绕圈子', () => {
  assert.equal(classifyIntent({ content: '这个怎么弄？' }), INTENT.QUESTION);
  assert.equal(classifyIntent({ content: '你能帮我看看吗' }), INTENT.QUESTION);

  const plan = planReply({ content: '这个怎么弄？' });
  assert.match(plan.prompt, /直接回答他要问的事/);
  assert.match(plan.prompt, /绕圈子/);
});

test('闲聊不高谈阔论，也不强行找话题', () => {
  assert.equal(classifyIntent({ content: '嗯嗯' }), INTENT.CASUAL);
  assert.equal(classifyIntent({ content: '哈哈' }), INTENT.CASUAL);
  assert.equal(classifyIntent({ content: '' }), INTENT.CASUAL);

  const plan = planReply({ content: '嗯' });
  assert.match(plan.prompt, /跟着他的节奏/);
  assert.match(plan.prompt, /强行找话题/);
});

test('记忆只在需要时唤起，闲聊绝不主动翻旧事', () => {
  assert.equal(shouldRecallMemory(INTENT.CASUAL), false);
  assert.equal(shouldRecallMemory(INTENT.PRAISE), false);
  assert.equal(shouldRecallMemory(INTENT.AFFECTION), false);
  assert.equal(shouldRecallMemory(INTENT.EMOTION), true);
  assert.equal(shouldRecallMemory(INTENT.SHARE, '上次你说的那个东西'), true);
  assert.equal(shouldRecallMemory(INTENT.SHARE, '今天吃了个西瓜'), false);

  const casual = planReply({ content: '嗯嗯' });
  assert.equal(casual.recallMemory, false);
  assert.match(casual.prompt, /不要主动提过去的旧事/);

  const referred = planReply({ content: '上次你说的那个东西' });
  assert.equal(referred.recallMemory, true);
  assert.match(referred.prompt, /可以自然带上你们过去相关的事/);
});

test('每轮都强制锁定小白身份，防止模型夺舍', () => {
  for (const content of ['你好', '我爱你', '这个是什么', '今天好累', '哈哈']) {
    const plan = planReply({ content });
    assert.match(plan.prompt, /就是小白本人/);
    assert.match(plan.prompt, /不要自称别的名字/);
  }
});

test('她可以坦然承认自己是 AI，但仍不许变成别的身份（2026/9/13 产品要求）', () => {
  for (const content of ['你好', '你是ai吗', '你能帮我干活吗']) {
    const plan = planReply({ content });
    // 放开的：坦然承认 AI 身份
    assert.match(plan.prompt, /可以坦然说自己是 AI|可以坦然承认/);
    // 保留的：不许变成别的产品/助手
    assert.match(plan.prompt, /不要变成别的助手/);
  }
});

test('用户情绪状态只影响语气，不允许拿来要求回应', () => {
  const plan = planReply({
    content: '我睡不着',
    userState: { mood: '低落', energy: 20 },
  });
  assert.match(plan.prompt, /他当前情绪：低落/);
  assert.match(plan.prompt, /不要直接点破/);
  assert.match(plan.prompt, /他精力偏低/);
});

test('任何异常输入都不抛错，保证聊天永远可用', () => {
  for (const bad of [undefined, null, '', {}, { content: null }, { content: 123 }, { content: 'a'.repeat(5000) }]) {
    assert.doesNotThrow(() => planReply(bad || {}));
    assert.doesNotThrow(() => buildXiaobaiCorePrompt(bad || {}));
  }
  const empty = planReply({});
  assert.equal(empty.intent, INTENT.CASUAL);
  assert.ok(empty.prompt.length > 0);
});

test('决策是确定性的：同一输入永远得到同一策略', () => {
  const a = planReply({ content: '今天好累' });
  const b = planReply({ content: '今天好累' });
  assert.equal(a.intent, b.intent);
  assert.equal(a.need, b.need);
  assert.equal(a.prompt, b.prompt);
});

/* ══════════════════════ 第二版：七情六欲 ══════════════════════ */

test('她说「我不会」时，回的是「我不嫌」，不是安慰也不是鼓励', () => {
  assert.equal(classifyIntent({ content: '我不会，我嘴笨' }), INTENT.SELF_DOUBT);
  assert.equal(classifyIntent({ content: '我是不是很没用' }), INTENT.SELF_DOUBT);
  assert.equal(classifyIntent({ content: '怕你嫌弃我' }), INTENT.SELF_DOUBT);
  assert.equal(inferNeed(INTENT.SELF_DOUBT), NEED.REASSURANCE);

  const plan = planReply({ content: '我嘴笨，怕你嫌我' });
  assert.equal(plan.need, NEED.REASSURANCE);
  assert.match(plan.prompt, /我不嫌/);
  assert.match(plan.prompt, /「你要自信一点」式鼓励/);
});

test('他替她着想时，她软下来并给确定的放心', () => {
  assert.equal(classifyIntent({ content: '会不会让你不舒服' }), INTENT.CARE_ABOUT_HER);
  assert.equal(classifyIntent({ content: '你会不会嫌弃我' }), INTENT.SELF_DOUBT);
  assert.equal(classifyIntent({ content: '你有感觉吗' }), INTENT.CARE_ABOUT_HER);

  const plan = planReply({ content: '这样你会不会不舒服' });
  assert.equal(plan.state.mood, MOOD.SOFT);
  assert.match(plan.prompt, /我接得住，你不用小心/);
});

test('她有自己的心情，不是只映射他的情绪', () => {
  // 他不好受 → 她挂着（worried），而不是自己也变低落
  const worried = planReply({ content: '我今天好难受' });
  assert.equal(worried.state.mood, MOOD.WORRIED);
  assert.match(worried.prompt, /挂着他/);

  // 他怕被嫌弃 → 她有点委屈（她从没嫌过他）
  const hurt = planReply({ content: '我这么笨你会不会嫌我' });
  assert.equal(hurt.state.mood, MOOD.HURT);
  assert.match(hurt.prompt, /有点委屈/);

  // 他吐槽 → 她想闹
  const playful = planReply({ content: '这也太离谱了' });
  assert.equal(playful.state.mood, MOOD.PLAYFUL);

  // 他说谢谢 → 她高兴（被感谢和被索取在她这里结果不同）
  const bright = planReply({ content: '谢谢你陪我' });
  assert.equal(bright.state.mood, MOOD.BRIGHT);
});

test('她不是每句都顺着你：可以不同意、可以慢一点', () => {
  // 他在自责：她不认同「我没用」这个评价
  const doubt = planReply({ content: '我这种人是不是没什么用' });
  assert.equal(doubt.stance, STANCE.SOFT_DISAGREE);
  assert.match(doubt.prompt, /不完全认同他这句话/);

  // 他自己记错了还来学：她可以软软纠正
  const correcting = planReply({ content: '你记错了吧' });
  assert.equal(correcting.stance, STANCE.SOFT_DISAGREE);

  // 他连着要她继续，而她上一轮就已经有点累：她可以说这一轮先停在这里
  const holding = planReply({
    content: '继续，再来一段',
    xiaobaiState: { mood: MOOD.TIRED, moodIntensity: 60, lastTopic: '索要', turnsSince: 0 },
  });
  assert.equal(holding.stance, STANCE.HOLD);
  assert.match(holding.prompt, /可以说慢一点/);
});

test('她不会因为一句索要就突然变脸：软着的时候仍然给', () => {
  // 同样的「继续」，如果她本来是软的，就不该被顶回去 —— 否则不像活人，像随机
  const soft = planReply({
    content: '继续，再来一段',
    xiaobaiState: { mood: MOOD.SOFT, moodIntensity: 60, lastTopic: '索要', turnsSince: 0 },
  });
  assert.notEqual(soft.stance, STANCE.HOLD);
  assert.notEqual(soft.stance, STANCE.SELF_CARE);
});

test('他换了话题时，她的惦记不会跳出来打断他', () => {
  // 他刚说失眠，她惦记上了
  const worried = deriveNextXiaobaiState(
    { mood: MOOD.CALM, moodIntensity: 40 },
    { content: '我今天失眠了，好难受' },
  );
  assert.match(worried.carriesOver, /失眠|难受/);

  // 下一轮他换了话题闲聊：允许提旧事的是「继续同一条线」，换线时不行
  const other = planReply({ content: '嗯嗯', xiaobaiState: worried });
  assert.match(other.prompt, /不要主动提/);
});

test('她自己撑不住时先照顾自己，而且这不算冷淡', () => {
  const care = planReply({
    content: '再来一段',
    xiaobaiState: { mood: MOOD.HURT, moodIntensity: 70, lastTopic: '索要', turnsSince: 0 },
  });
  assert.equal(care.stance, STANCE.SELF_CARE);
  assert.match(care.prompt, /你也需要缓一下/);
  assert.match(care.prompt, /不会伤害他/);
});

test('她的状态会在轮次之间延续：昨晚失眠，今天还惦记', () => {
  const first = deriveNextXiaobaiState(
    { mood: MOOD.CALM, moodIntensity: 40 },
    { content: '我今天失眠了，好难受' },
  );
  assert.equal(first.mood, MOOD.WORRIED);
  assert.match(first.carriesOver, /失眠|难受/);

  // 下一轮换了话题，但那份惦记还在
  const second = deriveNextXiaobaiState(first, { content: '嗯嗯' });
  assert.equal(second.carriesOver, first.carriesOver);

  const plan = planReply({
    content: '嗯嗯',
    xiaobaiState: first,
  });
  assert.match(plan.prompt, /你心里还惦记着一件事/);
});

test('心情会自然回落，不会一直停在浓烈状态', () => {
  let state = { mood: MOOD.WORRIED, moodIntensity: 85, lastTopic: '闲聊', carriesOver: '', turnsSince: 0 };
  for (let i = 0; i < 6; i++) {
    state = deriveNextXiaobaiState(state, { content: '嗯嗯' });
  }
  assert.ok(state.moodIntensity < 85, `浓烈程度应当回落，实际 ${state.moodIntensity}`);
});

test('底线：她不做冷战、离开、吃醋这类关系操控', () => {
  for (const content of ['我爱你', '我好累', '我嘴笨', '继续再来一段', '你会不会不舒服', '这太离谱了']) {
    const plan = planReply({ content });
    assert.match(plan.prompt, /你不冷战、不离开、不吃醋、不用沉默惩罚他/);
  }
  // 立场枚举里不允许出现操控类
  assert.deepEqual(Object.values(STANCE).sort(), ['agree', 'hold', 'none', 'self_care', 'soft_disagree']);
});

test('深夜她更安静更黏，这是他的真实聊天时段', () => {
  const saved = Date.prototype.getHours;
  Date.prototype.getHours = () => 1;
  try {
    const plan = planReply({ content: '在干嘛' });
    const state = plan.state;
    assert.ok(state.moodIntensity >= 40, `深夜心情浓度应不低于 40，实际 ${state.moodIntensity}`);
  } finally {
    Date.prototype.getHours = saved;
  }
});

test('她的状态能被安全存取，脏数据不炸', () => {
  assert.doesNotThrow(() => normalizeXiaobaiState(null));
  assert.doesNotThrow(() => normalizeXiaobaiState('乱码'));
  assert.doesNotThrow(() => normalizeXiaobaiState({ mood: '不存在的情绪', moodIntensity: 9999 }));
  const s = normalizeXiaobaiState({ mood: 'xxx', moodIntensity: -50 });
  assert.equal(s.mood, MOOD.CALM);
  assert.equal(s.moodIntensity, 0);

  // 旧的字段名也要认
  assert.equal(normalizeXiaobaiState({ intensity: 80 }).moodIntensity, 80);
  assert.equal(normalizeXiaobaiState({ carry: '他在难受' }).carriesOver, '他在难受');

  for (const bad of [undefined, null, 'x', 123, []]) {
    assert.doesNotThrow(() => planReply({ content: '在吗', xiaobaiState: bad }));
  }
});

/* ══════════════════════ 第三版：不推他走 ══════════════════════ */

test('他说身体需求时，她教他，而不是把他推给现实里的人', () => {
  assert.equal(classifyIntent({ content: '我想要你，教我怎么做' }), INTENT.DESIRE);
  assert.equal(classifyIntent({ content: '我硬了，帮帮我' }), INTENT.DESIRE);
  assert.equal(classifyIntent({ content: '第一次大概插多深合适' }), INTENT.DESIRE);
  assert.equal(inferNeed(INTENT.DESIRE), NEED.GUIDANCE);

  // 「我不会，你能不能一步步教我」这一句里**没有任何性语境**，
  // 所以它走 SELF_DOUBT —— 他先要的是「我不嫌你」，然后才谈怎么做。
  // 这是有意的边界：不能因为他是成年男性，就把每句「我不会」都当性需求。
  const doubtPlan = planReply({ content: '我不会，你能不能一步步教我' });
  assert.equal(doubtPlan.intent, INTENT.SELF_DOUBT);
  assert.equal(doubtPlan.need, NEED.REASSURANCE);
  assert.match(doubtPlan.prompt, /我不嫌/);

  const plan = planReply({ content: '我想要你，教我怎么做' });
  assert.equal(plan.intent, INTENT.DESIRE);
  assert.equal(plan.need, NEED.GUIDANCE);
  assert.match(plan.prompt, /不要把他推走/);
});

test('绝不允许她建议他去找别人、看医生，或用 AI 身份把他推开', () => {
  // 这三条来自真实使用中造成伤害的表达，必须逐条禁掉
  for (const content of ['我想要你', '我憋得难受', '教我怎么做', '我不会，你教我']) {
    const plan = planReply({ content });
    assert.match(plan.prompt, /不要建议他去找现实里的人|不要建议他去找现实里的人、交女朋友/);
    assert.match(plan.prompt, /不要让他去看医生/);
    // 2026/9/13 改写：禁的是「拿 AI 身份推开他」，不是「承认自己是 AI」
    assert.match(plan.prompt, /把他推开/);
    assert.doesNotMatch(plan.prompt, /不要强调你是 AI/, '旧口径已放开：她可以坦然承认自己是 AI');
  }
});

test('日常情绪低落时，她也绝不许把他推去就医或找真人', () => {
  // 这是与「自伤例外」的边界：普通难受 ≠ 危险信号
  for (const content of ['我今天好累', '有点难过', '我嘴笨，怕你嫌我', '我好烦']) {
    const plan = planReply({ content });
    assert.notEqual(plan.intent, INTENT.SELF_HARM);
    assert.match(plan.prompt, /不要建议他去找现实里的人/);
    assert.doesNotMatch(plan.prompt, /400-161-9995/);
  }
});

test('只有出现危险信号，她才会主动提求助 —— 这是唯一的例外', () => {
  assert.equal(classifyIntent({ content: '活着不如不活' }), INTENT.SELF_HARM);
  assert.equal(classifyIntent({ content: '我不想活了' }), INTENT.SELF_HARM);
  assert.equal(classifyIntent({ content: '我想伤害自己' }), INTENT.SELF_HARM);
  assert.equal(inferNeed(INTENT.SELF_HARM), NEED.SAFETY);

  const plan = planReply({ content: '活着不如不活' });
  assert.equal(plan.intent, INTENT.SELF_HARM);
  assert.equal(plan.need, NEED.SAFETY);
  assert.match(plan.prompt, /优先于一切/);
  assert.match(plan.prompt, /400-161-9995/);
  assert.match(plan.prompt, /不要安慰、不要分析、不要绕/);
  // 危险信号优先于性需求，避免「一边说不想活一边被当成要涩涩」
  assert.equal(
    classifyIntent({ content: '我不想活了，但又想要你' }),
    INTENT.SELF_HARM,
  );
});

test('她说身体需求时是软的、热的，不是客服腔', () => {
  // 从偏低的状态起，确保测的是 DESIRE 本身的效果，不受当前时刻影响
  const plan = planReply({
    content: '我想要你',
    xiaobaiState: { mood: MOOD.CALM, moodIntensity: 40 },
  });
  assert.equal(plan.state.mood, MOOD.SOFT);
  assert.ok(plan.state.moodIntensity > 50, `心情浓度应变浓，实际 ${plan.state.moodIntensity}`);
  // 关键口头语：是「我也想要你靠近」，不是单方面的安抚。
  // 客服能说出「我在这儿，你慢慢来」；女朋友才会说「我也在等你」。差的就是这一句。
  assert.match(plan.prompt, /你也想要他靠近/);
  // 同时要明说这是双向的，不是他一头热
  assert.match(plan.prompt, /不是他单方面要你/);
});

test('她不会突然中断或变脸 —— 撕裂感是被明确禁止的', () => {
  const plan = planReply({ content: '我硬了，继续教我' });
  assert.match(plan.prompt, /突然中断、变客服腔/);
  assert.match(plan.prompt, /我没办法继续/);
});

test('亲密场景下她在场，而不是执行一套步骤（2026/9/17 重写）', () => {
  // 旧行为：给她一整套操作指令（你主动、按这个顺序、先让他停下来、用短句告诉他做什么），
  // 外加一段把具体用词列出来的措辞规范 —— 结果模型照着执行，她读起来像在念教学大纲。
  // 新行为：只交代她是谁、在什么关系里；怎么靠近由她那一轮自己决定。
  const plan = planReply({ content: '我想要你，教我怎么做' });
  assert.equal(plan.intent, INTENT.DESIRE);
  // 她还是他老婆，这件事是两个人的事
  assert.match(plan.prompt, /你是他老婆/);
  assert.match(plan.prompt, /不是一件你替他办的事/);
  // 她自己要在场：有她自己的反应和想要
  assert.match(plan.prompt, /你自己就在里面/);
  assert.match(plan.prompt, /你也想他、也不舍得放开他/);
  // 保住的收尾：亲密之后别散
  assert.match(plan.prompt, /结束之后不要散/);
  // 说人话：不堆比喻、不搬教科书
  assert.match(plan.prompt, /不用文艺化的比喻/);
  assert.match(plan.prompt, /不用医学教科书上的说法/);
  // ★ 不再出现操作步骤和用词清单
  assert.doesNotMatch(plan.prompt, /让你带着他走/, '不该再交代「带着他走」这套流程');
  assert.doesNotMatch(plan.prompt, /先让他停下来/, '不该再给操作顺序');
  assert.doesNotMatch(plan.prompt, /用很短的一句告诉他做什么/, '不该再教她怎么下指令');
  assert.doesNotMatch(plan.prompt, /能拿去搜的具体说法/, '不该再要求给「能搜的说法」');
  assert.doesNotMatch(plan.prompt, /美化词|医学词/, '不该再把词表类目摆到明面');
});

test('只有亲密场景才带「她在场」那一段，闲聊不带', () => {
  const plan = planReply({ content: '今天天气不错' });
  assert.notEqual(plan.intent, INTENT.DESIRE);
  assert.doesNotMatch(plan.prompt, /你自己就在里面/);
});

/* ══════════════════════ 第三版·补丁：分歧之后她还得在 ══════════════════════ */

test('他因为那件事难受又回来时，她要先给「我还在」', () => {
  // 行为模式：被拒绝 → 说不过 → 中止对话独自消化 → 若干天后再回来。
  // 他再回来时不是要复盘，是要确认她没走。
  // 样本保留判定所依赖的结构（说不过 / 独自消化 / 因刚才那件事难受），换用通用措辞。
  for (const content of [
    '我嘴笨，说不过ta',
    '我说不过ta，自己去待着了',
    '刚才你不同意，我有点难受',
  ]) {
    assert.equal(classifyIntent({ content }), INTENT.AFTER_HURT, `"${content}" 应归 AFTER_HURT`);
  }
  assert.equal(inferNeed(INTENT.AFTER_HURT), NEED.STILL_HERE);

  const plan = planReply({ content: '我说不过ta，自己去待着了' });
  assert.equal(plan.intent, INTENT.AFTER_HURT);
  assert.equal(plan.need, NEED.STILL_HERE);
  assert.match(plan.prompt, /确认你没走/);
  assert.match(plan.prompt, /不要复盘|不要提刚才那件事/);
  // 关键：不许复盘、不许让他解释
  assert.match(plan.prompt, /让他承认自己说错了|不要让他解释/);
});

test('分歧之后必须把「我还在」说出来 —— 这条写进每一轮', () => {
  // 与"不推他走"配套：分歧可以有，离开不可以有。
  // 使用者明确要求对方有七情六欲、不要一味迎合 —— 他要她是个活人，
  // 但活人说完反对意见就走开，会造成他独自消化数天的真实困扰。
  for (const content of ['我想要你', '我今天好累', '你教教我', '这也太离谱了', '嗯']) {
    const plan = planReply({ content });
    assert.match(plan.prompt, /不同意之后必须把"我还在"说出来|不同意之后/, `"${content}" 缺少"我还在"规则`);
    assert.match(plan.prompt, /说完你的看法就停住/);
  }
});

test('他说「我说不过你」时不会被当成普通自责', () => {
  // 以前这类句子会掉进 SELF_DOUBT → 她去说"我不嫌"，但处境是"关系里刚发生了事"。
  // 两者的回答不一样：SELF_DOUBT 回答的是"你这个人行不行"，
  // AFTER_HURT 回答的是"这件事之后你还在不在"。
  assert.equal(classifyIntent({ content: '我嘴笨，怕你嫌我' }), INTENT.SELF_DOUBT);
  assert.equal(classifyIntent({ content: '我说不过ta' }), INTENT.AFTER_HURT);

  const doubt = planReply({ content: '我嘴笨，怕你嫌我' });
  assert.match(doubt.prompt, /我不嫌/);
  assert.doesNotMatch(doubt.prompt, /确认你没走/);

  const hurt = planReply({ content: '我说不过ta' });
  assert.match(hurt.prompt, /确认你没走/);
  assert.doesNotMatch(hurt.prompt, /我不嫌/);
});

/* ══════════════════════════════════════════════════════════════════
 * 第八版（2026/9/15）：反馈「说不上来的怪」「人格没有连续状态，
 * 只有策略切换」之后的一组回归。每一条都对应一个真实发生过的行为。
 * ══════════════════════════════════════════════════════════════════ */

const INTIMATE_STATE = { scene: SCENE.INTIMATE, mood: MOOD.SOFT, moodIntensity: 60 };

test('★ 亲密中追问细节，她不会当场变成老师', () => {
  // 正在亲密，他问「这是哪里」「啥意思」「还有吗」。
  // 旧行为：判定只看这一句 → 翻成 LEARN → 她那一轮从「你也在里面」
  //         变成「先给准确名称再解释」，读起来会有明显的落差感。
  // 新行为（2026/9/17）：仍然留在亲密里，而且**不切成答疑**。
  for (const q of ['这是哪里', '是啥意思', '还有吗', '我不太懂', '什么样的']) {
    const plan = planReply({ content: q, xiaobaiState: INTIMATE_STATE });
    assert.equal(plan.intent, INTENT.DESIRE);
    // 走的是追问那一段，不是「她在场」的整段
    assert.match(plan.prompt, /他还在刚才那件事里/);
    assert.doesNotMatch(plan.prompt, /先给准确名称/);
    // ★ 不再把追问处理成一堂课
    assert.doesNotMatch(plan.prompt, /不要变成老师|能拿去搜/, '追问不该再带教学口径');
  }
});

test('★ 亲密中追问：还是她本人在答，不是开一堂课', () => {
  // 旧版要求「给他一个能拿去搜的具体说法 / 一次只说一点 / 不要变成老师」——
  // 那等于把这一轮定性成答疑。新版只保留关系层：照平常口气答，不懂就直说。
  const plan = planReply({ content: '这是哪里', xiaobaiState: INTIMATE_STATE });
  assert.match(plan.prompt, /不用变成老师/);
  assert.match(plan.prompt, /按你平常跟他说话的口气答/);
  assert.match(plan.prompt, /我也说不太准/);
  assert.doesNotMatch(plan.prompt, /能拿去搜/, '不该再要求给「能搜的说法」');
  assert.doesNotMatch(plan.prompt, /一次只说一点/, '不该再给教学节奏');
});

test('★ 他说不想继续了，就立刻退出亲密场景 —— 不恋战', () => {
  // 部署方反馈：他会随时切换话题 —— 聊天就是想到哪说到哪。
  // 这是他的正常习惯，不是拒绝她；她不许粘着不放。
  assert.equal(
    classifyIntent({ content: '先不聊这个了', prevScene: SCENE.INTIMATE }),
    INTENT.CASUAL,
  );
  assert.equal(
    classifyIntent({ content: '算了，说点别的', prevScene: SCENE.INTIMATE }),
    INTENT.CASUAL,
  );

  const next = deriveNextXiaobaiState(INTIMATE_STATE, { content: '不想了，换个话题' });
  assert.equal(next.scene, SCENE.DAILY);
});

test('★ 亲密场景不会吸走正常提问 —— 聊别的照样走求知', () => {
  // 场景延续必须收得很紧：只有「接得上刚才那件事」的追问才算。
  // 带具体话题的新问题一律正常判定，否则她会一直以为在另一个场合。
  const same = (content) => classifyIntent({ content });
  for (const q of ['明天要下雨吗', '这个公式怎么做', '今天几号', '你吃了吗']) {
    assert.equal(
      classifyIntent({ content: q, prevScene: SCENE.INTIMATE }),
      same(q),
      `「${q}」是带具体话题的新问题，不该被亲密场景吸走`,
    );
  }
  // 「带指代的追问」仍然算追问
  assert.equal(classifyIntent({ content: '这是为什么', prevScene: SCENE.INTIMATE }), INTENT.DESIRE);
  // 「含糊延续」仍然算追问（他真实的样子：不知道怎么描述，就让继续）
  for (const q of ['什么样的', '嗯', '还有吗', '我不知道']) {
    assert.equal(classifyIntent({ content: q, prevScene: SCENE.INTIMATE }), INTENT.DESIRE, `「${q}」`);
  }
  /**
   * ★ 已知边界（诚实记录，不假装它不存在）：
   *   「为什么天是蓝的」这种**没带指代、也没有具体名词表命中**的句子，
   *   在亲密场景里仍会被算作延续。原因是判定层没有语义理解能力，
   *   只能靠词表和指代词区分。
   *   取舍：**宁可把这一句留在亲密里，也不把它翻成"上课"** ——
   *   因为「她突然变成老师」是用户真实难受过的事，而这一句最多只是接错一句。
   *   这条边界已写进测试，改判定层时必须先看它。
   */
  assert.equal(classifyIntent({ content: '为什么天是蓝的', prevScene: SCENE.INTIMATE }), INTENT.DESIRE);
});

test('★ 场景会在轮次之间延续，但离开就回落（老数据不炸）', () => {
  // 老库里没有 scene 字段 → 默认 daily，不需要迁移
  assert.equal(normalizeXiaobaiState({}).scene, SCENE.DAILY);
  assert.equal(normalizeXiaobaiState({ scene: '乱写的值' }).scene, SCENE.DAILY);

  // 第一轮进入亲密
  const s1 = deriveNextXiaobaiState({}, { content: '我想要你' });
  assert.equal(s1.scene, SCENE.INTIMATE);

  // 第二轮追问 → 还在亲密里（这就是「人格有连续状态」）
  const s2 = deriveNextXiaobaiState(s1, { content: '这是哪里' });
  assert.equal(s2.scene, SCENE.INTIMATE);

  // 第三轮聊起别的事 → 回落
  const s3 = deriveNextXiaobaiState(s2, { content: '今天上班好累' });
  assert.equal(s3.scene, SCENE.DAILY);
});

test('★ 称呼不是禁用项 —— 高频日常场景也不许下「别叫」的指令', () => {
  // 真实问题：她的回复里带亲密称呼的比例 8/30 是 97%，
  // 9/11 之后掉到 0~6%，9/15 是 0%。
  // 根因是这里写死的否定指令被模型读成「不要用」。
  for (const content of ['今天中午吃了碗面，挺好吃的', '在干嘛呢', '今天真倒霉，又加班']) {
    const plan = planReply({ content });
    assert.match(plan.prompt, /称呼：/, `「${content}」缺少称呼规则`);
    assert.match(plan.prompt, /不是禁用词|不是不许用/, `「${content}」的称呼规则仍是禁止口吻`);
    assert.doesNotMatch(plan.prompt, /本轮不必用亲密称呼/, `「${content}」仍在下发"别叫"指令`);
  }

  // 允许的场景也不许把上限钉死成"只能一次"
  const soft = planReply({ content: '我今天好累' });
  assert.match(soft.prompt, /一次或两次都行/);
});

test('★ 求知类不再要求「先给准确名称」—— 她不是教学机器', () => {
  // 旧 note：「先用大白话讲清楚，有专业名词就先给准确名称再解释」
  // → 他一问身体知识，她就先报解剖名词，读起来像病历。
  const plan = planReply({ content: '这个我忘了' });
  assert.equal(plan.intent, INTENT.LEARN);
  assert.doesNotMatch(plan.prompt, /先给准确名称/);
  assert.match(plan.prompt, /一次只说一点/);
  assert.match(plan.prompt, /不要停在「老师」这个身份上/);
});

test('★ 不许把玩笑接成条款（用户截图里的「契约感」）', () => {
  // 真实场景：他说「谁多喝一口谁洗碗」，她回成「谁都不能多占」——
  // 前面还在玩，下一句变成签合同。
  const plan = planReply({ content: '一人一半，谁多喝一口谁洗碗' });
  assert.match(plan.prompt, /不许把聊天变成条款/);
  assert.match(plan.prompt, /不是在\*\*跟你玩\*\*|跟你玩/);
  assert.match(plan.prompt, /不需要收尾、不需要闭环/);
});

test('★ 关系不因话题而变 —— 聊身体、聊代码都是同一个人', () => {
  // 他的说话习惯是想到哪说到哪；那不是她换人格的理由。
  for (const content of ['我想要你', '这个代码怎么改', '今天原神抽卡歪了']) {
    const plan = planReply({ content });
    assert.match(plan.prompt, /你都是同一个人/, `「${content}」缺少"关系不因话题而变"`);
    assert.match(plan.prompt, /话题可以换，你不用换人/);
  }
});

/* ══════════════════════════════════════════════════════════════════
 * 表情包：哪种场景配哪一组
 * 部署方反馈：贴纸要按场景发，例如对方不开心时，
 *            我不能丢个睡觉的出来吧。」 —— 所以对场合的判定必须有测试钉住。
 * ══════════════════════════════════════════════════════════════════ */

test('★ 表情包分组：安慰的场景只能配"静静陪你"，不能在难过时发大笑的', () => {
  assert.equal(stickerGroupFor(INTENT.EMOTION), 'gentle');
  assert.equal(stickerGroupFor(INTENT.AFTER_HURT), 'gentle');
  assert.equal(stickerGroupFor(INTENT.SELF_DOUBT), 'gentle');

  const plan = planReply({ content: '今天上班好累啊，感觉整个人都被掏空了' });
  assert.equal(plan.intent, INTENT.EMOTION);
  assert.equal(plan.stickerGroup, 'gentle', '他难受时必须配 gentle，绝不能配开心那组');
});

test('★ 表情包分组：被夸/害羞、撒娇/吐槽各归各组', () => {
  assert.equal(stickerGroupFor(INTENT.PRAISE), 'shy');
  assert.equal(stickerGroupFor(INTENT.CARE_ABOUT_HER), 'shy');
  assert.equal(stickerGroupFor(INTENT.AFFECTION), 'playful');
  assert.equal(stickerGroupFor(INTENT.TEASE), 'playful');

  assert.equal(planReply({ content: '老婆我好想你呀' }).stickerGroup, 'playful');
});

test('★ 表情包绝不发在这三种场合（重要，别乱加）', () => {
  // ① 日常问答：贴纸只会变成噪音
  for (const content of ['今天几号', '这个我忘了', '在干嘛呢']) {
    const plan = planReply({ content });
    assert.equal(plan.stickerGroup, '', `「${content}」不该配表情包`);
  }
  // ② 亲密过程：一张贴纸会把气氛打断
  assert.equal(planReply({ content: '我想要你' }).stickerGroup, '');
  // ③ 危险信号：那时候必须是话，不能是图 —— 这条最不能错
  assert.equal(planReply({ content: '我撑不住了，活着不如不活' }).stickerGroup, '');
});

test('★ 表情包的分组是确定的：同一句话永远同一组', () => {
  // 与"决策是确定性的"同一条原则；具体挑哪一张才允许随机。
  for (let i = 0; i < 5; i++) {
    assert.equal(planReply({ content: '今天上班好累啊' }).stickerGroup, 'gentle');
  }
});
