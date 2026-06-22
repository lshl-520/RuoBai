export const DEFAULT_USER_AVATAR = "/assets/default-user-avatar.webp";
export const DEFAULT_ROLE_AVATAR = "/assets/portraits/round/0.png";

export function fallbackImageTo(src) {
  return (event) => {
    const img = event.currentTarget;
    if (!img || img.dataset.fallbackApplied === "1") return;
    img.dataset.fallbackApplied = "1";
    img.src = src;
  };
}

export const fallbackToDefaultUserAvatar = fallbackImageTo(DEFAULT_USER_AVATAR);
export const fallbackToDefaultRoleAvatar = fallbackImageTo(DEFAULT_ROLE_AVATAR);
