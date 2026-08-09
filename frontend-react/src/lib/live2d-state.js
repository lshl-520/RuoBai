function expressionNameFromPath(filePath) {
  const name = String(filePath || "").replaceAll("\\\\", "/").split("/").pop() || "";
  return name.replace(/\.exp3\.json$/i, "");
}

export function getLive2DExpressionNames(manifest) {
  return (Array.isArray(manifest?.expressionPaths) ? manifest.expressionPaths : [])
    .map(expressionNameFromPath)
    .filter(Boolean);
}

export function classifyChatLive2DScene(text) {
  const content = String(text || "").trim();
  if (!content) return "idle";

  if (/(想你|喜欢你|爱你|老婆|抱抱|亲亲|亲爱的|宝贝|宝宝|想抱|想亲)/u.test(content)) {
    return "affection";
  }
  if (/(好看|可爱|漂亮|真棒|厉害|喜欢.*(?:样子|衣服|声音|头像))/u.test(content)) {
    return "praise";
  }
  return "idle";
}

export function getChatLive2DState(messages = [], { isResponding = false } = {}) {
  const hasStreamingReply = messages.some((message) => Boolean(message?._streaming));
  if (!isResponding && !hasStreamingReply) return { scene: "idle" };

  const lastUserMessage = [...messages].reverse().find((message) => message?.who === "me");
  return { scene: classifyChatLive2DScene(lastUserMessage?.text) };
}

export function resolveLive2DExpression(state, manifest) {
  const scene = typeof state === "string" ? state : state?.scene;
  const wantedByScene = {
    affection: "爱心眼",
    praise: "脸红",
  };
  const wanted = wantedByScene[scene];
  if (!wanted) return "";

  return getLive2DExpressionNames(manifest).find((name) => name === wanted) || "";
}

export function getLive2DExpressionIndex(expressionName, manifest) {
  return getLive2DExpressionNames(manifest).indexOf(String(expressionName || ""));
}
