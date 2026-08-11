function latestMomentResponseEvent(events) {
  if (!Array.isArray(events)) return null;
  return events.find((event) => event?.event_type === "moment_response") || null;
}

export function getMomentResponseStatus({ enabled = false, events = [] } = {}) {
  if (!enabled) {
    return { tone: "off", label: "默认关闭", description: "保存后才会生效" };
  }

  const latest = latestMomentResponseEvent(events);
  switch (latest?.status) {
    case "skipped":
      return { tone: "skip", label: "最近一次：跳过", description: "她这次选择不留言" };
    case "generation_failed":
      return { tone: "failure", label: "暂时不可用", description: "这次没有生成评论" };
    case "processing":
      return { tone: "processing", label: "正在处理", description: "这条动态正在准备回应" };
    case "created":
      return { tone: "created", label: "已回应", description: "已在动态下留言" };
    default:
      return { tone: "ready", label: "已开启", description: "等待首次回应" };
  }
}
