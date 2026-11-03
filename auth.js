import { createHash, randomUUID } from "node:crypto";
import { compare, hash } from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

export const accessTokenSeconds = 15 * 60;
export const refreshTokenSeconds = 8 * 60 * 60;
export const passwordLength = Object.freeze({ min: 12, max: 128 });

const issuer = "rio-claro";
const audience = "rio-claro-web";
const accessCookieName = "rio_claro_access";
const refreshCookieName = "rio_claro_refresh";

export function validatePassword(password) {
  return (
    typeof password === "string" &&
    password.length >= passwordLength.min &&
    password.length <= passwordLength.max
  );
}

export function hashRefreshId(id) {
  return createHash("sha256").update(id).digest("hex");
}

export function createAuthService({ store, tokenSecret }) {
  if (typeof tokenSecret !== "string" || Buffer.byteLength(tokenSecret) < 32) {
    throw new Error("AUTH_TOKEN_SECRET debe tener al menos 32 caracteres.");
  }
  const secret = new TextEncoder().encode(tokenSecret);

  async function signToken({ sessionId, userId, tokenType, jti, lifetime }) {
    return new SignJWT({ sid: sessionId, typ: tokenType })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setIssuer(issuer)
      .setAudience(audience)
      .setJti(jti)
      .setIssuedAt()
      .setExpirationTime(`${lifetime}s`)
      .sign(secret);
  }

  async function verifyToken(token, expectedType) {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
      issuer,
      audience,
    });
    if (
      payload.typ !== expectedType ||
      typeof payload.sub !== "string" ||
      typeof payload.sid !== "string" ||
      typeof payload.jti !== "string"
    ) {
      throw new Error("Token de sesión no válido.");
    }
    return payload;
  }

  function getCookie(request, name) {
    const cookies = request.get("cookie")?.split(";") ?? [];
    for (const cookie of cookies) {
      const separator = cookie.indexOf("=");
      if (separator >= 0 && cookie.slice(0, separator).trim() === name) {
        return cookie.slice(separator + 1).trim();
      }
    }
    return null;
  }

  function setCookies(response, tokens) {
    const secure = process.env.NODE_ENV === "production";
    response.cookie(accessCookieName, tokens.accessToken, {
      httpOnly: true,
      secure,
      sameSite: "strict",
      path: "/",
      maxAge: accessTokenSeconds * 1000,
    });
    response.cookie(refreshCookieName, tokens.refreshToken, {
      httpOnly: true,
      secure,
      sameSite: "strict",
      path: "/api/auth",
      maxAge: refreshTokenSeconds * 1000,
    });
  }

  function clearCookies(response) {
    const secure = process.env.NODE_ENV === "production";
    response.clearCookie(accessCookieName, {
      httpOnly: true,
      secure,
      sameSite: "strict",
      path: "/",
    });
    response.clearCookie(refreshCookieName, {
      httpOnly: true,
      secure,
      sameSite: "strict",
      path: "/api/auth",
    });
  }

  async function issueSession(user, isGuest = false) {
    const sessionId = randomUUID();
    const refreshJti = randomUUID();
    const expiresAt = new Date(Date.now() + refreshTokenSeconds * 1000);
    const accessToken = await signToken({
      sessionId,
      userId: user.id,
      tokenType: "access",
      jti: randomUUID(),
      lifetime: accessTokenSeconds,
    });
    const refreshToken = await signToken({
      sessionId,
      userId: user.id,
      tokenType: "refresh",
      jti: refreshJti,
      lifetime: refreshTokenSeconds,
    });
    await store.createSession({
      id: sessionId,
      userId: user.id,
      refreshJtiHash: hashRefreshId(refreshJti),
      expiresAt,
      isGuest,
    });
    return { accessToken, refreshToken };
  }

  async function authenticate(request) {
    const token = getCookie(request, accessCookieName);
    if (!token) {
      return null;
    }
    let payload;
    try {
      payload = await verifyToken(token, "access");
    } catch {
      return null;
    }
    const session = await store.getSession(payload.sid);
    if (
      !session ||
      session.revokedAt ||
      new Date(session.expiresAt).getTime() <= Date.now() ||
      session.userId !== payload.sub
    ) {
      return null;
    }
    const user = await store.findUserById(payload.sub);
    if (!user || user.status !== "activo") {
      return null;
    }
    return user;
  }

  async function refresh(request) {
    const token = getCookie(request, refreshCookieName);
    if (!token) {
      return null;
    }
    let payload;
    try {
      payload = await verifyToken(token, "refresh");
    } catch {
      return null;
    }
    const session = await store.getSession(payload.sid);
    if (
      !session ||
      session.revokedAt ||
      new Date(session.expiresAt).getTime() <= Date.now() ||
      session.userId !== payload.sub
    ) {
      return null;
    }
    if (hashRefreshId(payload.jti) !== session.refreshJtiHash) {
      await store.revokeSession(session.id);
      return null;
    }
    const user = await store.findUserById(payload.sub);
    if (!user || user.status !== "activo") {
      await store.revokeSession(session.id);
      return null;
    }

    const refreshJti = randomUUID();
    const expiresAt = new Date(Date.now() + refreshTokenSeconds * 1000);
    const accessToken = await signToken({
      sessionId: session.id,
      userId: user.id,
      tokenType: "access",
      jti: randomUUID(),
      lifetime: accessTokenSeconds,
    });
    const refreshToken = await signToken({
      sessionId: session.id,
      userId: user.id,
      tokenType: "refresh",
      jti: refreshJti,
      lifetime: refreshTokenSeconds,
    });
    const rotated = await store.rotateSession(
      session.id,
      session.refreshJtiHash,
      hashRefreshId(refreshJti),
      expiresAt,
    );
    return rotated ? { accessToken, refreshToken, user } : null;
  }

  async function authenticatePassword(username, password) {
    const user =
      typeof username === "string"
        ? await store.findUserByUsername(username.trim().toLocaleLowerCase("es-MX"))
        : null;
    if (
      !user ||
      user.status !== "activo" ||
      user.isGuest ||
      typeof user.passwordHash !== "string" ||
      typeof password !== "string" ||
      password.length < 1 ||
      password.length > passwordLength.max ||
      !(await compare(password, user.passwordHash))
    ) {
      return null;
    }
    return user;
  }

  return {
    authenticate,
    authenticatePassword,
    clearCookies,
    getCookie,
    hashPassword: (password) => hash(password, 12),
    issueSession,
    refresh,
    setCookies,
    verifyToken,
  };
}

export { accessCookieName, refreshCookieName };
