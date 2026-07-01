import bcrypt from 'bcrypt';

const COST = 10;

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, COST);
}

export function comparePassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}
