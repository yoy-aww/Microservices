// 所有服务共享的端点配置。改一处，全项目生效。
export const AUTH_URL = process.env.AUTH_URL ?? 'http://localhost:3000';
export const HELLO_URL = process.env.HELLO_URL ?? 'http://localhost:3001';

// 同一个密钥：auth 用来签 token，其他服务用来验 token。
// 真实系统：每个服务有自己的验签公钥，但签 token 的服务只发私钥。
// 这里为了教学把对称密钥放共享模块，让你能一眼看到"密钥泄漏 = 任何人都能伪造身份"。
export const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'dev-only-secret-change-me'
);
