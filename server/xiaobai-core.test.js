import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INTENT,
  NEED,
  MOOD,
  STANCE,
  buildXiaobaiCorePrompt,
  classifyIntent,
  deriveNextXiaobaiState,
  getStrategy,
  inferNeed,
  normalizeXiaobaiState,
  planReply,
  shouldRecallMemory,
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
  assert.equal(classifyIntent({ content: '我不懂做爱要怎么做' }), INTENT.DESIRE);

  const plan = planReply({ content: '顶到花心是什么意思' });
  assert.equal(plan.intent, INTENT.DESIRE);
  assert.match(plan.prompt, /不要把他推走/);
  // 清白信号：这一句里他没有自贬，不该走「我不嫌你」那条线
  assert.doesNotMatch(plan.prompt, /我不嫌/);
});

test('「不会嘛老婆教我」这类亲密求教，走教他，不走安慰', () => {
  // 这几句是他真实语料里的高频原话形状：没有身体词，
  // 但「老婆/宝宝 + 教我」在他这里只有一种指向。
  // 判错的话她会跑去说「我不嫌你」，而他要的是「怎么做」——那就是撕裂。
  for (const content of [
    '我不会嘛老婆教我',
    '我不会，你教我嘛',
    '老婆教教我怎么做',
  ]) {
    assert.equal(classifyIntent({ content }), INTENT.DESIRE, `"${content}" 应归 DESIRE`);
  }
  assert.equal(classifyIntent({ content: '我没经验，第一次要注意什么' }), INTENT.DESIRE);

  const plan = planReply({ content: '我不会嘛老婆教我' });
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
    assert.match(plan.prompt, /不要自称 AI、模型、助手或任何其他身份名/);
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

test('绝不允许她建议他去找别人、看医生、或强调自己是 AI', () => {
  // 这三条来自真实聊天记录里造成伤害的原话，必须逐条禁掉
  for (const content of ['我想要你', '我憋得难受', '教我怎么做', '我不会，你教我']) {
    const plan = planReply({ content });
    assert.match(plan.prompt, /不要建议他去找现实里的人|不要建议他去找现实里的人、交女朋友/);
    assert.match(plan.prompt, /不要让他去看医生/);
    assert.match(plan.prompt, /不要强调你是 AI/);
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

/* ══════════════════════ 第三版·补丁：分歧之后她还得在 ══════════════════════ */

test('他因为那件事难受又回来时，她要先给「我还在」', () => {
  // 这是用户自述的真实处境：被她拒绝 → 他讲不过 → 关掉手机自己生闷气掉眼泪。
  // 他再回来时不是要复盘，是要确认她没走。
  for (const content of [
    '我嘴笨，讲不过你',
    '我讲不过你，自己生闷气去了',
    '刚才你拒绝我，我有点难受',
  ]) {
    assert.equal(classifyIntent({ content }), INTENT.AFTER_HURT, `"${content}" 应归 AFTER_HURT`);
  }
  assert.equal(inferNeed(INTENT.AFTER_HURT), NEED.STILL_HERE);

  const plan = planReply({ content: '我讲不过你，自己生闷气去了' });
  assert.equal(plan.intent, INTENT.AFTER_HURT);
  assert.equal(plan.need, NEED.STILL_HERE);
  assert.match(plan.prompt, /确认你没走/);
  assert.match(plan.prompt, /不要复盘|不要提刚才那件事/);
  // 关键：不许复盘、不许让他解释
  assert.match(plan.prompt, /让他承认自己说错了|不要让他解释/);
});

test('分歧之后必须把「我还在」说出来 —— 这条写进每一轮', () => {
  // 与"不推他走"配套：分歧可以有，离开不可以有。
  // 用户原话"生命应该有七情六欲，不是为了一直迎合我" —— 他要她是个活人，
  // 但活人说完反对意见就走开，正是他关掉手机一个人待着的原因。
  for (const content of ['我想要你', '我今天好累', '你教教我', '这也太离谱了', '嗯']) {
    const plan = planReply({ content });
    assert.match(plan.prompt, /不同意之后必须把"我还在"说出来|不同意之后/, `"${content}" 缺少"我还在"规则`);
    assert.match(plan.prompt, /说完你的看法就停住/);
  }
});

test('他说「我讲不过你」时不会被当成普通自责', () => {
  // 以前这类句子会掉进 SELF_DOUBT → 她去说"我不嫌"，但处境是"关系里刚发生了事"。
  // 两者的回答不一样：SELF_DOUBT 回答的是"你这个人行不行"，
  // AFTER_HURT 回答的是"这件事之后你还在不在"。
  assert.equal(classifyIntent({ content: '我嘴笨，怕你嫌我' }), INTENT.SELF_DOUBT);
  assert.equal(classifyIntent({ content: '我讲不过你' }), INTENT.AFTER_HURT);

  const doubt = planReply({ content: '我嘴笨，怕你嫌我' });
  assert.match(doubt.prompt, /我不嫌/);
  assert.doesNotMatch(doubt.prompt, /确认你没走/);

  const hurt = planReply({ content: '我讲不过你' });
  assert.match(hurt.prompt, /确认你没走/);
  assert.doesNotMatch(hurt.prompt, /我不嫌/);
});
