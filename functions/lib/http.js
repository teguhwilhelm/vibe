export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json;charset=UTF-8",
      ...(init.headers || {}),
    },
  });
}

export function error(message, status = 400, extra = {}) {
  return json({ error: message, ...extra }, { status });
}

export function parseCookies(request) {
  const header = request.headers.get("Cookie") || "";
  const out = {};
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

export function sessionCookie(token, maxAgeSeconds) {
  const attrs = [
    `session=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  return attrs.join("; ");
}

export function clearSessionCookie() {
  return "session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

// Loads the current user (if any) from the session cookie.
export async function getCurrentUser(request, env) {
  const cookies = parseCookies(request);
  const token = cookies.session;
  if (!token) return null;

  const row = await env.DB.prepare(
    `SELECT s.token, s.expires_at, u.* FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`
  )
    .bind(token)
    .first();

  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) return null;

  delete row.password_hash;
  delete row.password_salt;
  return row;
}

export function requireAuth(user) {
  if (!user) return error("Not signed in.", 401);
  return null;
}

export function requireAdmin(user) {
  const authErr = requireAuth(user);
  if (authErr) return authErr;
  if (user.role !== "admin") return error("Admins only.", 403);
  return null;
}
