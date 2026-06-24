import { ErrorCode } from './constants.js';

/** 类型化应用错误（engine 与 server 共用） */
export class AppError extends Error {
  override readonly name = 'AppError';
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

/** 错误工厂：集中维护错误码、状态码、文案 */
export const Errors = {
  tableNotFound: (name: string) =>
    new AppError(ErrorCode.TABLE_NOT_FOUND, 404, `表 ${name} 不存在或未发布`),
  tableNoPrimaryKey: (name: string) =>
    new AppError(ErrorCode.TABLE_NO_PRIMARY_KEY, 422, `表 ${name} 无主键，无法导入`),
  tableCompositePrimaryKey: (name: string) =>
    new AppError(ErrorCode.TABLE_COMPOSITE_PRIMARY_KEY, 422, `表 ${name} 为复合主键，暂不支持`),
  tableNotEditable: (name: string) =>
    new AppError(ErrorCode.TABLE_NOT_EDITABLE, 403, `表 ${name} 不可编辑`),
  tableAlreadyExists: (name: string) =>
    new AppError(ErrorCode.TABLE_ALREADY_EXISTS, 409, `表 ${name} 已存在`),
  invalidName: (name: string) =>
    new AppError(ErrorCode.INVALID_NAME, 400, `名称 ${name} 不合法，需匹配 ^[a-z][a-z0-9_]*$`),
  reservedName: (name: string) =>
    new AppError(ErrorCode.RESERVED_NAME, 400, `名称 ${name} 为系统保留字`),
  validationFail: (msg: string) => new AppError(ErrorCode.VALIDATION_FAIL, 400, msg),
  dbError: () => new AppError(ErrorCode.DB_ERROR, 500, '数据库错误'),
  internalError: (msg: string) => new AppError(ErrorCode.INTERNAL_ERROR, 500, msg),
};
