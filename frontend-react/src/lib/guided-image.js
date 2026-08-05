export const GUIDED_IMAGE_OPTIONS = {
  scene: ["日常自拍", "居家生活", "吃饭", "看书", "游戏", "旅游", "陪宠物", "做饭", "工作"],
  style: ["手机随手拍", "朋友圈自拍", "日系写真", "动漫插画", "写实照片"],
  place: ["卧室", "客厅", "阳台", "厨房", "公园", "咖啡店", "海边"],
  state: ["爱笑", "有点害羞", "喜欢发呆", "抱着猫", "晒太阳", "看窗外", "赖床"],
  outfit: ["白色针织衫", "奶白睡衣", "浅蓝毛衣", "米白连衣裙", "卫衣", "家居服"],
};

export function buildGuidedImageSubject({
  characterName = "她",
  scene = GUIDED_IMAGE_OPTIONS.scene[0],
  style = GUIDED_IMAGE_OPTIONS.style[0],
  place = GUIDED_IMAGE_OPTIONS.place[0],
  state = GUIDED_IMAGE_OPTIONS.state[0],
  outfit = GUIDED_IMAGE_OPTIONS.outfit[0],
} = {}) {
  const name = String(characterName || "她").trim().slice(0, 30) || "她";
  return [
    `请生成角色“${name}”的一张${style}。`,
    `她在${place}${scene}，${state}，穿${outfit}。`,
    "保持角色本人的固定年龄感、脸型、眼睛、发色和气质，只改变当天的衣服、地点和拍摄方式。",
    "画面只出现她本人；涉及陪伴场景使用第一人称视角，不出现用户本人、陌生男性、男性的手或身体、影子、倒影，也不要多人合照。",
  ].join(" ");
}
