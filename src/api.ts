const errors: Record<string, string> = {
  UNAUTHORIZED: "登录已过期，请重新登录",
  INVALID_CREDENTIALS: "用户名或密码错误，请重试",
  FILE_TOO_LARGE: "文件超过服务端大小限制，请缩小文件后重试",
  UNSUPPORTED_FILE: "暂不支持此文件类型，请使用 PDF、Word 或图片",
  INVALID_SIGNATURE: "文件内容与扩展名不一致，请检查原文件",
  QUEUE_FULL: "本地解析队列已满，请等待现有任务完成后重试",
  STILL_PROCESSING: "报告仍在本地解析中，请稍候",
  NO_EXCERPTS: "请先在原文中勾选至少一个证据片段",
  NO_SAFE_EXCERPTS:
    "所选片段没有可安全提取的已识别检验指标。请选择具体指标行，或先补充支持的临床字段标注",
  INVALID_ANCHOR: "证据锚点已变更，请重新选择",
  CONSENT_REQUIRED: "请先审核脱敏预览并勾选本次分析确认",
  PREVIEW_NOT_FOUND: "这份预览已失效或已使用，请返回并重新生成预览",
  PREVIEW_EXPIRED: "预览已过期，请返回并重新审核",
  PREVIEW_MISMATCH: "所选证据已变化，请重新生成预览",
  PREVIEW_STALE: "报告或设置已变化，请重新生成预览",
  AI_KEY_MISSING:
    "实时模式需要在服务端配置 GLM_API_KEY 并重启；请勿将密钥粘贴到此界面",
  AI_NETWORK_ERROR:
    "模型请求失败或超时。已确认的片段可能已送达服务商，请重新审核预览后再试",
  AI_PROVIDER_ERROR:
    "模型服务返回错误，请检查服务端模型配置并重新审核预览后再试",
  AI_INVALID_OUTPUT: "模型返回内容未通过格式或引用检查，未保存不可靠的结论",
  ANALYSIS_IN_PROGRESS: "当前报告正在分析，请等待完成",
  REPORT_CHANGED:
    "分析时报告已发生更改，结果未写入。已确认的片段可能已送达模型服务",
  REPORT_NOT_FOUND: "未找到报告，请刷新列表",
  INTERNAL_ERROR: "服务未能安全完成请求，请查看本地服务日志后重试",
};
export class ApiError extends Error {
  code?: string;
  status?: number;
  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export type AuthSession = {
  authenticated: boolean;
  username: "admin" | null;
  demo: true;
};
export const AUTH_EXPIRED_EVENT = "med-report:auth-expired";
let authEpoch = 0;
// Ignore late 401s from a workspace that has already been unmounted.
export const advanceAuthSession = () => ++authEpoch;

async function responseError(
  response: Response,
  requestEpoch: number,
  authRequest = false,
): Promise<ApiError> {
  let body: any = {};
  try {
    body = await response.json();
  } catch {}
  if (response.status === 401 && !authRequest && requestEpoch === authEpoch) {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }
  return new ApiError(
    errors[body.code] ||
      body.error ||
      (response.status === 401
        ? "登录已过期，请重新登录"
        : `请求失败（${response.status}），请重试`),
    body.code,
    response.status,
  );
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const requestEpoch = authEpoch;
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw await responseError(
      response,
      requestEpoch,
      path.startsWith("/auth/"),
    );
  }
  return response.json();
}
export const json = (value: unknown) => JSON.stringify(value);
export async function downloadReport(
  id: string,
  format: string,
  filename: string,
) {
  const requestEpoch = authEpoch;
  const response = await fetch(
    `/api/reports/${encodeURIComponent(id)}/export?format=${format}`,
    { credentials: "same-origin" },
  );
  if (!response.ok) {
    throw await responseError(response, requestEpoch);
  }
  if (requestEpoch !== authEpoch)
    throw new ApiError("登录状态已变更，请重新导出", "SESSION_CHANGED");
  const blob = await response.blob();
  if (requestEpoch !== authEpoch)
    throw new ApiError("登录状态已变更，请重新导出", "SESSION_CHANGED");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename.replace(/\.[^.]+$/, "")}_分析报告.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
