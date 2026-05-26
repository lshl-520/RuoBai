export function buildCapabilityLoadErrorMessage(error) {
  const message = String(error?.message || '未知错误');

  return `没能拉到能力面板（${message}）。<br>试试：<br>1. 双击根目录"一键关闭.bat"再"一键启动.bat"重启后端<br>2. 如果提示请先登录，就重新登录一次<br>3. 还不行的话截图给 AI 看看`;
}

export async function parseCapabilityResponseError(response) {
  let payload = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (response.status === 401) {
    return new Error('请先登录');
  }

  if (response.status === 404) {
    return new Error('接口没找到，像是后端还没重启');
  }

  if (payload?.error) {
    return new Error(String(payload.error));
  }

  if (response.status >= 500) {
    return new Error(`后端报错了（${response.status}）`);
  }

  return new Error(`加载失败（${response.status}）`);
}
