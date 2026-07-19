// 视频链接识别与上下文提取
// 目前支持：抖音 (v.douyin.com / www.douyin.com) 、TikTok (vm.tiktok.com / www.tiktok.com)

const VIDEO_URL_RE = /https?:\/\/(?:v\.douyin\.com|www\.douyin\.com|vm\.tiktok\.com|www\.tiktok\.com)\/[^\s,，。！!?\]）)>]+/;

/**
 * 从消息文本里提取视频分享上下文
 * 抖音分享格式：[短码] [时间] [标题描述] #标签1 #标签2 https://v.douyin.com/xxx/ 复制此链接...
 * @param {string} content
 * @returns {{ url: string, desc: string, tags: string[] } | null}
 */
function extractVideoShareContext(content) {
  if (!content) return null;
  const urlMatch = content.match(VIDEO_URL_RE);
  if (!urlMatch) return null;

  const url = urlMatch[0];
  const urlIndex = content.indexOf(url);
  const beforeUrl = content.slice(0, urlIndex);

  // 提取话题标签（#标签 或 # 标签 两种格式）
  const tags = [...beforeUrl.matchAll(/#\s*([一-龥A-Za-z0-9_]+)/g)].map(m => m[1]);

  // 提取描述：去掉前面的乱码短码（通常是「0.05 xxx:/」这类分享口令），去掉标签
  let desc = beforeUrl
    .replace(/^[\s\S]{0,30}?\s+(?=[一-龥])/, '') // 跳过开头短码，定位到首个中文
    .replace(/#[一-龥A-Za-z0-9_]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // 去掉「复制此链接…」等结尾说明
  desc = desc.replace(/复制此链接[\s\S]*$/, '').trim();

  if (!desc && !tags.length) return null;

  return { url, desc, tags, platform: url.includes('douyin') ? '抖音' : 'TikTok' };
}

/**
 * 生成注入给 AI 的系统提示片段
 */
function buildVideoShareHint(ctx) {
  if (!ctx) return '';

  const parts = [];
  if (ctx.desc) parts.push(`视频描述：${ctx.desc}`);
  if (ctx.tags.length) parts.push(`话题：${ctx.tags.join('、')}`);

  return (
    `\n\n[系统注：用户刚分享了一个${ctx.platform}视频。` +
    parts.join('；') +
    `。请自然地回应视频内容（可以评论、聊感受、问细节），` +
    `不要说"我看不了视频"或"我无法访问链接"。]`
  );
}

export { extractVideoShareContext, buildVideoShareHint };
