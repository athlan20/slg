// 账号密码哈希（scrypt，Node 内置实现，不引入原生依赖）。
// 只在 API 进程使用；哈希格式带参数，便于将来调整成本因子。

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

/** scrypt 成本参数：内存约 128 * N * r = 16MB，低于 Node 默认 maxmem */
const PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 64;

/** 存储格式：scrypt$N$r$p$saltBase64$hashBase64 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, KEY_LEN, PARAMS);
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  // 防御异常存储值被构造成高成本参数
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) || N < 1 || r < 1 || p < 1 || N * r > 1 << 20) {
    return false;
  }
  try {
    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    if (salt.length === 0 || expected.length === 0 || expected.length > 512) {
      return false;
    }
    const actual = await scrypt(password.normalize('NFKC'), salt, expected.length, { N, r, p });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
