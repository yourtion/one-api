/**
 * SDK 统一错误类型。
 * - 业务错误：服务端返回信封 {success:false, error:{code,message}} + HTTP 4xx/5xx → code/message 来自信封。
 * - 网络错误：fetch 抛出 / 非 JSON 响应 → code='NETWORK_ERROR', statusCode=0。
 *
 * 消费侧用 `instanceof OneApiError` 判断 + 读 `.code` 分支处理。
 */
export class OneApiError extends Error {
  override readonly name = 'OneApiError';
  /** 业务错误码（如 TABLE_NOT_FOUND / VALIDATION_FAIL / NETWORK_ERROR） */
  readonly code: string;
  /** HTTP 状态码（网络错误为 0） */
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 0) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}
