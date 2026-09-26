// 用 jose 库做 JWT：HS256 对称签名（教学用；生产用 RS256/EdDSA + 公私钥对）
import { SignJWT, jwtVerify } from 'jose';
import { JWT_SECRET } from './config.js';

export async function signToken(payload, { expiresIn = '2h' } = {}) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(JWT_SECRET);
}

export async function verifyToken(token) {
  // 验签 + 验过期，两者都过才返回 payload
  const { payload } = await jwtVerify(token, JWT_SECRET);
  return payload;
}

// 从 Authorization: Bearer xxx 里抠出 token；没有返回 null
export function extractBearerToken(header) {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}
