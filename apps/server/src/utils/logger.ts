import debug from 'debug';

export const log = {
  request: debug('one-api:request'),
  sql: debug('one-api:sql'),
  error: debug('one-api:error'),
  startup: debug('one-api:startup'),
};
