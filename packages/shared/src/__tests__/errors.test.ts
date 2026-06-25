import { describe, expect, it } from 'vitest';
import { AppError, Errors } from '../index.js';

describe('AppError', () => {
  it('携带 code/statusCode/message', () => {
    const e = new AppError('TABLE_NOT_FOUND', 404, '表 foo 不存在');
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('TABLE_NOT_FOUND');
    expect(e.statusCode).toBe(404);
    expect(e.message).toBe('表 foo 不存在');
    expect(e.name).toBe('AppError');
  });
});

describe('Errors 工厂', () => {
  it('tableNotFound', () => {
    const e = Errors.tableNotFound('foo');
    expect(e.code).toBe('TABLE_NOT_FOUND');
    expect(e.statusCode).toBe(404);
  });
  it('tableNoPrimaryKey', () => {
    expect(Errors.tableNoPrimaryKey('foo').code).toBe('TABLE_NO_PRIMARY_KEY');
    expect(Errors.tableNoPrimaryKey('foo').statusCode).toBe(422);
  });
  it('tableCompositePrimaryKey', () => {
    expect(Errors.tableCompositePrimaryKey('foo').code).toBe('TABLE_COMPOSITE_PRIMARY_KEY');
  });
  it('tableNotEditable', () => {
    expect(Errors.tableNotEditable('foo').statusCode).toBe(403);
  });
  it('tableAlreadyExists', () => {
    expect(Errors.tableAlreadyExists('foo').statusCode).toBe(409);
  });
  it('invalidName / reservedName', () => {
    expect(Errors.invalidName('Foo').code).toBe('INVALID_NAME');
    expect(Errors.reservedName('schema').code).toBe('RESERVED_NAME');
  });
  it('validationFail', () => {
    expect(Errors.validationFail('字段非法').code).toBe('VALIDATION_FAIL');
    expect(Errors.validationFail('字段非法').statusCode).toBe(400);
  });
  it('dbError / internalError', () => {
    expect(Errors.dbError().statusCode).toBe(500);
    expect(Errors.internalError('boom').code).toBe('INTERNAL_ERROR');
  });
  it('unauthorized → 401 UNAUTHORIZED', () => {
    const e = Errors.unauthorized();
    expect(e.code).toBe('UNAUTHORIZED');
    expect(e.statusCode).toBe(401);
  });
  it('invalidToken → 401 INVALID_TOKEN', () => {
    const e = Errors.invalidToken();
    expect(e.code).toBe('INVALID_TOKEN');
    expect(e.statusCode).toBe(401);
  });
  it('forbidden → 403 FORBIDDEN', () => {
    const e = Errors.forbidden();
    expect(e.code).toBe('FORBIDDEN');
    expect(e.statusCode).toBe(403);
  });
  it('authInvalidCredentials → 401 UNAUTHORIZED', () => {
    const e = Errors.authInvalidCredentials();
    expect(e.code).toBe('UNAUTHORIZED');
    expect(e.statusCode).toBe(401);
  });
});
