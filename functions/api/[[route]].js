import { newId, newToken, hashPassword, verifyPassword } from "../lib/crypto.js";
import {
  json,
  error,
  sessionCookie,
  clearSessionCookie,
  getCurrentUser,
  requireAuth,
  requireAdmin,
} from "../lib/http.js";
import { matchLocation, computeRotatingShift, todayStr } from "../lib/geo.js";

const SESSION_DAYS = 14;

export async function onRequest(context) {
  const { request, env, params } = context;
  const segments = params.route || [];
  const method = request.method;
  const path = "/" + segments.join("/");

  try {
    const user = await getCurrentUser(request, env);

    // ---- AUTH ----
    if (path === "/auth/register-company" && method === "POST")
      return registerCompany(request, env);
    if (path === "/auth/login" && method === "POST") return login(request, env);
    if (path === "/auth/logout" && method === "POST") return logout(request, env, user);
    if (path === "/auth/me" && method === "GET") return json({ user });

    // ---- EMPLOYEES (admin) ----
    if (path === "/employees" && method === "GET") return listEmployees(env, user);
    if (path === "/employees" && method === "POST") return createEmployee(request, env, user);
    if (segments[0] === "employees" && segments[1] && method === "PUT")
      return updateEmployee(request, env, user, segments[1]);
    if (segments[0] === "employees" && segments[1] && method === "DELETE")
      return deleteEmployee(env, user, segments[1]);

    // ---- LOCATIONS ----
    if (path === "/locations" && method === "GET") return listLocations(env, user);
    if (path === "/locations" && method === "POST") return createLocation(request, env, user);
    if (segments[0] === "locations" && segments[1] && method === "PUT")
      return updateLocation(request, env, user, segments[1]);
    if (segments[0] === "locations" && segments[1] && method === "DELETE")
      return deleteLocation(env, user, segments[1]);

    // ---- SHIFTS ----
    if (path === "/shifts" && method === "GET") return listShifts(env, user);
    if (path === "/shifts" && method === "POST") return createShift(request, env, user);
    if (segments[0] === "shifts" && segments[1] && method === "PUT")
      return updateShift(request, env, user, segments[1]);
    if (segments[0] === "shifts" && segments[1] && method === "DELETE")
      return deleteShift(env, user, segments[1]);
    if (path === "/shifts/assign-rotation" && method === "POST")
      return assignRotation(request, env, user);
    if (path === "/shifts/today" && method === "GET") return shiftToday(request, env, user);

    // ---- ATTENDANCE ----
    if (path === "/attendance/clock-in" && method === "POST")
      return clockIn(request, env, user);
    if (path === "/attendance/clock-out" && method === "POST")
      return clockOut(request, env, user);
    if (path === "/attendance" && method === "GET") return listAttendance(request, env, user);

    // ---- LEAVE ----
    if (path === "/leave" && method === "GET") return listLeave(request, env, user);
    if (path === "/leave" && method === "POST") return createLeave(request, env, user);
    if (segments[0] === "leave" && segments[1] && method === "PUT")
      return updateLeave(request, env, user, segments[1]);

    // ---- REPORTS ----
    if (path === "/reports/summary" && method === "GET")
      return reportsSummary(request, env, user);

    return error("Not found.", 404);
  } catch (err) {
    return error(err.message || "Server error.", 500);
  }
}

// ===================== AUTH =====================

async function registerCompany(request, env) {
  const body = await request.json().catch(() => ({}));
  const { companyName, adminName, email, password, timezone } = body;
  if (!companyName || !adminName || !email || !password)
    return error("Company name, admin name, email, and password are required.");
  if (password.length < 8) return error("Password must be at least 8 characters.");

  const existing = await env.DB.prepare(`SELECT id FROM users WHERE email = ?`)
    .bind(email.toLowerCase())
    .first();
  if (existing) return error("That email is already registered.", 409);

  const companyId = newId("co");
  const userId = newId("usr");
  const { hash, salt } = await hashPassword(password);

  await env.DB.batch([
    env.DB.prepare(`INSERT INTO companies (id, name, timezone) VALUES (?, ?, ?)`).bind(
      companyId,
      companyName,
      timezone || "UTC"
    ),
    env.DB.prepare(
      `INSERT INTO users (id, company_id, employee_code, name, email, password_hash, password_salt, role)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'admin')`
    ).bind(userId, companyId, "ADM-001", adminName, email.toLowerCase(), hash, salt),
  ]);

  return startSession(env, userId);
}

async function login(request, env) {
  const { email, password } = await request.json().catch(() => ({}));
  if (!email || !password) return error("Email and password are required.");

  const row = await env.DB.prepare(`SELECT * FROM users WHERE email = ?`)
    .bind(email.toLowerCase())
    .first();
  if (!row) return error("Incorrect email or password.", 401);
  if (row.status !== "active") return error("This account is not active.", 403);

  const ok = await verifyPassword(password, row.password_hash, row.password_salt);
  if (!ok) return error("Incorrect email or password.", 401);

  return startSession(env, row.id);
}

async function startSession(env, userId) {
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await env.DB.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`)
    .bind(token, userId, expires)
    .run();

  const user = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(userId).first();
  delete user.password_hash;
  delete user.password_salt;

  return json(
    { user },
    { headers: { "Set-Cookie": sessionCookie(token, SESSION_DAYS * 86400) } }
  );
}

async function logout(request, env, user) {
  const cookies = request.headers.get("Cookie") || "";
  const match = cookies.match(/session=([^;]+)/);
  if (match) {
    await env.DB.prepare(`DELETE FROM sessions WHERE token = ?`).bind(match[1]).run();
  }
  return json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
}

// ===================== EMPLOYEES =====================

async function listEmployees(env, user) {
  const err = requireAuth(user);
  if (err) return err;
  const rows = await env.DB.prepare(
    `SELECT id, employee_code, name, email, role, department, position, status,
            rotation_shift_ids, rotation_start_date, rotation_interval_days, created_at
     FROM users WHERE company_id = ? ORDER BY name`
  )
    .bind(user.company_id)
    .all();
  return json({ employees: rows.results });
}

async function createEmployee(request, env, user) {
  const err = requireAdmin(user);
  if (err) return err;
  const body = await request.json().catch(() => ({}));
  const { name, email, password, employee_code, department, position, role } = body;
  if (!name || !email || !password || !employee_code)
    return error("Name, email, employee code, and password are required.");

  const existing = await env.DB.prepare(
    `SELECT id FROM users WHERE company_id = ? AND email = ?`
  )
    .bind(user.company_id, email.toLowerCase())
    .first();
  if (existing) return error("An employee with that email already exists.", 409);

  const { hash, salt } = await hashPassword(password);
  const id = newId("usr");
  await env.DB.prepare(
    `INSERT INTO users (id, company_id, employee_code, name, email, password_hash, password_salt, role, department, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      user.company_id,
      employee_code,
      name,
      email.toLowerCase(),
      hash,
      salt,
      role === "admin" ? "admin" : "employee",
      department || null,
      position || null
    )
    .run();

  return json({ id }, { status: 201 });
}

async function updateEmployee(request, env, user, id) {
  const err = requireAdmin(user);
  if (err) return err;
  const body = await request.json().catch(() => ({}));
  const target = await env.DB.prepare(`SELECT * FROM users WHERE id = ? AND company_id = ?`)
    .bind(id, user.company_id)
    .first();
  if (!target) return error("Employee not found.", 404);

  const fields = [];
  const values = [];
  for (const col of ["name", "employee_code", "department", "position", "role", "status"]) {
    if (body[col] !== undefined) {
      fields.push(`${col} = ?`);
      values.push(body[col]);
    }
  }
  if (body.password) {
    const { hash, salt } = await hashPassword(body.password);
    fields.push("password_hash = ?", "password_salt = ?");
    values.push(hash, salt);
  }
  if (fields.length === 0) return error("Nothing to update.");
  values.push(id);
  await env.DB.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  return json({ ok: true });
}

async function deleteEmployee(env, user, id) {
  const err = requireAdmin(user);
  if (err) return err;
  if (id === user.id) return error("You cannot delete your own account.");
  await env.DB.prepare(`DELETE FROM users WHERE id = ? AND company_id = ?`)
    .bind(id, user.company_id)
    .run();
  return json({ ok: true });
}

// ===================== LOCATIONS =====================

async function listLocations(env, user) {
  const err = requireAuth(user);
  if (err) return err;
  const rows = await env.DB.prepare(`SELECT * FROM locations WHERE company_id = ? ORDER BY name`)
    .bind(user.company_id)
    .all();
  return json({ locations: rows.results });
}

async function createLocation(request, env, user) {
  const err = requireAdmin(user);
  if (err) return err;
  const { name, latitude, longitude, radius_meters } = await request.json().catch(() => ({}));
  if (!name || latitude === undefined || longitude === undefined)
    return error("Name, latitude, and longitude are required.");
  const id = newId("loc");
  await env.DB.prepare(
    `INSERT INTO locations (id, company_id, name, latitude, longitude, radius_meters) VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(id, user.company_id, name, latitude, longitude, radius_meters || 150)
    .run();
  return json({ id }, { status: 201 });
}

async function updateLocation(request, env, user, id) {
  const err = requireAdmin(user);
  if (err) return err;
  const body = await request.json().catch(() => ({}));
  const fields = [];
  const values = [];
  for (const col of ["name", "latitude", "longitude", "radius_meters"]) {
    if (body[col] !== undefined) {
      fields.push(`${col} = ?`);
      values.push(body[col]);
    }
  }
  if (fields.length === 0) return error("Nothing to update.");
  values.push(id, user.company_id);
  await env.DB.prepare(`UPDATE locations SET ${fields.join(", ")} WHERE id = ? AND company_id = ?`)
    .bind(...values)
    .run();
  return json({ ok: true });
}

async function deleteLocation(env, user, id) {
  const err = requireAdmin(user);
  if (err) return err;
  await env.DB.prepare(`DELETE FROM locations WHERE id = ? AND company_id = ?`)
    .bind(id, user.company_id)
    .run();
  return json({ ok: true });
}

// ===================== SHIFTS =====================

async function listShifts(env, user) {
  const err = requireAuth(user);
  if (err) return err;
  const rows = await env.DB.prepare(`SELECT * FROM shifts WHERE company_id = ? ORDER BY start_time`)
    .bind(user.company_id)
    .all();
  return json({ shifts: rows.results });
}

async function createShift(request, env, user) {
  const err = requireAdmin(user);
  if (err) return err;
  const { name, start_time, end_time, grace_minutes } = await request.json().catch(() => ({}));
  if (!name || !start_time || !end_time)
    return error("Name, start time, and end time are required.");
  const id = newId("shf");
  await env.DB.prepare(
    `INSERT INTO shifts (id, company_id, name, start_time, end_time, grace_minutes) VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(id, user.company_id, name, start_time, end_time, grace_minutes ?? 10)
    .run();
  return json({ id }, { status: 201 });
}

async function updateShift(request, env, user, id) {
  const err = requireAdmin(user);
  if (err) return err;
  const body = await request.json().catch(() => ({}));
  const fields = [];
  const values = [];
  for (const col of ["name", "start_time", "end_time", "grace_minutes"]) {
    if (body[col] !== undefined) {
      fields.push(`${col} = ?`);
      values.push(body[col]);
    }
  }
  if (fields.length === 0) return error("Nothing to update.");
  values.push(id, user.company_id);
  await env.DB.prepare(`UPDATE shifts SET ${fields.join(", ")} WHERE id = ? AND company_id = ?`)
    .bind(...values)
    .run();
  return json({ ok: true });
}

async function deleteShift(env, user, id) {
  const err = requireAdmin(user);
  if (err) return err;
  await env.DB.prepare(`DELETE FROM shifts WHERE id = ? AND company_id = ?`)
    .bind(id, user.company_id)
    .run();
  return json({ ok: true });
}

// Assigns (or replaces) a rotating shift pattern to an employee, e.g.
// rotate weekly through [Morning, Afternoon, Night].
async function assignRotation(request, env, user) {
  const err = requireAdmin(user);
  if (err) return err;
  const { user_id, shift_ids, start_date, interval_days } = await request
    .json()
    .catch(() => ({}));
  if (!user_id || !Array.isArray(shift_ids) || shift_ids.length === 0 || !start_date)
    return error("user_id, shift_ids (non-empty array), and start_date are required.");

  await env.DB.prepare(
    `UPDATE users SET rotation_shift_ids = ?, rotation_start_date = ?, rotation_interval_days = ?
     WHERE id = ? AND company_id = ?`
  )
    .bind(JSON.stringify(shift_ids), start_date, interval_days || 7, user_id, user.company_id)
    .run();

  return json({ ok: true });
}

// Resolves + materializes the shift a user is on for a given date.
async function shiftToday(request, env, user) {
  const err = requireAuth(user);
  if (err) return err;
  const url = new URL(request.url);
  const targetUserId = url.searchParams.get("user_id") || user.id;
  const date = url.searchParams.get("date") || todayStr();

  if (targetUserId !== user.id && user.role !== "admin") return error("Forbidden.", 403);

  const target = await env.DB.prepare(`SELECT * FROM users WHERE id = ? AND company_id = ?`)
    .bind(targetUserId, user.company_id)
    .first();
  if (!target) return error("Employee not found.", 404);

  const shiftId = computeRotatingShift(target, date);
  if (!shiftId) return json({ shift: null });

  const shift = await env.DB.prepare(`SELECT * FROM shifts WHERE id = ?`).bind(shiftId).first();

  await env.DB.prepare(
    `INSERT INTO shift_assignments (id, user_id, shift_id, date) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, date) DO UPDATE SET shift_id = excluded.shift_id`
  )
    .bind(newId("asn"), targetUserId, shiftId, date)
    .run();

  return json({ shift });
}

// ===================== ATTENDANCE =====================

async function clockIn(request, env, user) {
  const err = requireAuth(user);
  if (err) return err;
  const { lat, lng, date } = await request.json().catch(() => ({}));
  if (lat === undefined || lng === undefined) return error("Location (lat/lng) is required.");

  const day = date || todayStr();
  const now = new Date().toISOString();

  const existing = await env.DB.prepare(
    `SELECT * FROM attendance WHERE user_id = ? AND date = ?`
  )
    .bind(user.id, day)
    .first();
  if (existing && existing.clock_in_at) return error("Already clocked in today.", 409);

  const locations = await env.DB.prepare(`SELECT * FROM locations WHERE company_id = ?`)
    .bind(user.company_id)
    .all();
  let locationId = null;
  if (locations.results.length > 0) {
    const match = matchLocation(locations.results, lat, lng);
    if (!match)
      return error(
        "You're not within range of any approved work location. Move closer and try again.",
        422
      );
    locationId = match.location.id;
  }

  const shiftId = computeRotatingShift(user, day);
  let status = "present";
  if (shiftId) {
    const shift = await env.DB.prepare(`SELECT * FROM shifts WHERE id = ?`).bind(shiftId).first();
    if (shift) {
      const nowTime = new Date().toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const [nh, nm] = nowTime.split(":").map(Number);
      const [sh, sm] = shift.start_time.split(":").map(Number);
      const lateBy = nh * 60 + nm - (sh * 60 + sm);
      if (lateBy > shift.grace_minutes) status = "late";
    }
  }

  const id = newId("att");
  if (existing) {
    await env.DB.prepare(
      `UPDATE attendance SET clock_in_at = ?, clock_in_lat = ?, clock_in_lng = ?, clock_in_location_id = ?, shift_id = ?, status = ?
       WHERE id = ?`
    )
      .bind(now, lat, lng, locationId, shiftId, status, existing.id)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO attendance (id, company_id, user_id, date, shift_id, clock_in_at, clock_in_lat, clock_in_lng, clock_in_location_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(id, user.company_id, user.id, day, shiftId, now, lat, lng, locationId, status)
      .run();
  }

  return json({ ok: true, clock_in_at: now, status });
}

async function clockOut(request, env, user) {
  const err = requireAuth(user);
  if (err) return err;
  const { lat, lng, date } = await request.json().catch(() => ({}));
  if (lat === undefined || lng === undefined) return error("Location (lat/lng) is required.");

  const day = date || todayStr();
  const existing = await env.DB.prepare(
    `SELECT * FROM attendance WHERE user_id = ? AND date = ?`
  )
    .bind(user.id, day)
    .first();
  if (!existing || !existing.clock_in_at) return error("You haven't clocked in today.", 409);
  if (existing.clock_out_at) return error("Already clocked out today.", 409);

  const locations = await env.DB.prepare(`SELECT * FROM locations WHERE company_id = ?`)
    .bind(user.company_id)
    .all();
  let locationId = null;
  if (locations.results.length > 0) {
    const match = matchLocation(locations.results, lat, lng);
    if (!match)
      return error(
        "You're not within range of any approved work location. Move closer and try again.",
        422
      );
    locationId = match.location.id;
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE attendance SET clock_out_at = ?, clock_out_lat = ?, clock_out_lng = ?, clock_out_location_id = ? WHERE id = ?`
  )
    .bind(now, lat, lng, locationId, existing.id)
    .run();

  return json({ ok: true, clock_out_at: now });
}

async function listAttendance(request, env, user) {
  const err = requireAuth(user);
  if (err) return err;
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") || "day";
  const anchor = url.searchParams.get("date") || todayStr();
  const requestedUserId = url.searchParams.get("user_id");

  let userFilter = user.id;
  if (user.role === "admin") userFilter = requestedUserId || null; // null = all employees

  const { from, to } = rangeForScope(scope, anchor);

  let query = `
    SELECT a.*, u.name AS user_name, u.employee_code, s.name AS shift_name
    FROM attendance a
    JOIN users u ON u.id = a.user_id
    LEFT JOIN shifts s ON s.id = a.shift_id
    WHERE a.company_id = ? AND a.date BETWEEN ? AND ?`;
  const binds = [user.company_id, from, to];
  if (userFilter) {
    query += ` AND a.user_id = ?`;
    binds.push(userFilter);
  }
  query += ` ORDER BY a.date DESC, u.name`;

  const rows = await env.DB.prepare(query).bind(...binds).all();
  return json({ from, to, records: rows.results });
}

function rangeForScope(scope, anchorStr) {
  const anchor = new Date(anchorStr + "T00:00:00Z");
  if (scope === "week") {
    const day = anchor.getUTCDay(); // 0 = Sunday
    const start = new Date(anchor);
    start.setUTCDate(anchor.getUTCDate() - day);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }
  if (scope === "month") {
    const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
    const end = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }
  return { from: anchorStr, to: anchorStr };
}

// ===================== LEAVE =====================

async function listLeave(request, env, user) {
  const err = requireAuth(user);
  if (err) return err;
  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status");

  let query = `
    SELECT l.*, u.name AS user_name, u.employee_code
    FROM leave_requests l JOIN users u ON u.id = l.user_id
    WHERE l.company_id = ?`;
  const binds = [user.company_id];
  if (user.role !== "admin") {
    query += ` AND l.user_id = ?`;
    binds.push(user.id);
  }
  if (statusFilter) {
    query += ` AND l.status = ?`;
    binds.push(statusFilter);
  }
  query += ` ORDER BY l.created_at DESC`;

  const rows = await env.DB.prepare(query).bind(...binds).all();
  return json({ requests: rows.results });
}

async function createLeave(request, env, user) {
  const err = requireAuth(user);
  if (err) return err;
  const { leave_type, start_date, end_date, reason } = await request.json().catch(() => ({}));
  if (!leave_type || !start_date || !end_date)
    return error("Leave type, start date, and end date are required.");
  const id = newId("lve");
  await env.DB.prepare(
    `INSERT INTO leave_requests (id, company_id, user_id, leave_type, start_date, end_date, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, user.company_id, user.id, leave_type, start_date, end_date, reason || null)
    .run();
  return json({ id }, { status: 201 });
}

async function updateLeave(request, env, user, id) {
  const err = requireAdmin(user);
  if (err) return err;
  const { status } = await request.json().catch(() => ({}));
  if (!["approved", "rejected", "pending"].includes(status)) return error("Invalid status.");

  const leave = await env.DB.prepare(
    `SELECT * FROM leave_requests WHERE id = ? AND company_id = ?`
  )
    .bind(id, user.company_id)
    .first();
  if (!leave) return error("Leave request not found.", 404);

  await env.DB.prepare(
    `UPDATE leave_requests SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`
  )
    .bind(status, user.id, new Date().toISOString(), id)
    .run();

  // Mark each day of an approved leave as an attendance record with status 'leave'.
  if (status === "approved") {
    const start = new Date(leave.start_date + "T00:00:00Z");
    const end = new Date(leave.end_date + "T00:00:00Z");
    const stmts = [];
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const dayStr = d.toISOString().slice(0, 10);
      stmts.push(
        env.DB.prepare(
          `INSERT INTO attendance (id, company_id, user_id, date, status)
           VALUES (?, ?, ?, ?, 'leave')
           ON CONFLICT(user_id, date) DO UPDATE SET status = 'leave'`
        ).bind(newId("att"), user.company_id, leave.user_id, dayStr)
      );
    }
    if (stmts.length) await env.DB.batch(stmts);
  }

  return json({ ok: true });
}

// ===================== REPORTS =====================

async function reportsSummary(request, env, user) {
  const err = requireAuth(user);
  if (err) return err;
  const url = new URL(request.url);
  const from = url.searchParams.get("from") || todayStr();
  const to = url.searchParams.get("to") || todayStr();

  let userFilter = user.role === "admin" ? url.searchParams.get("user_id") : user.id;

  let query = `
    SELECT u.id AS user_id, u.name, u.employee_code, u.department,
           SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present_count,
           SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) AS late_count,
           SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absent_count,
           SUM(CASE WHEN a.status = 'leave' THEN 1 ELSE 0 END) AS leave_count,
           COUNT(a.id) AS total_records
    FROM users u
    LEFT JOIN attendance a ON a.user_id = u.id AND a.date BETWEEN ? AND ?
    WHERE u.company_id = ?`;
  const binds = [from, to, user.company_id];
  if (userFilter) {
    query += ` AND u.id = ?`;
    binds.push(userFilter);
  }
  query += ` GROUP BY u.id ORDER BY u.name`;

  const rows = await env.DB.prepare(query).bind(...binds).all();
  const perEmployee = rows.results.map((r) => {
    const worked = r.present_count + r.late_count;
    const denom = worked + r.absent_count;
    return {
      ...r,
      attendance_rate: denom > 0 ? Math.round((worked / denom) * 1000) / 10 : null,
    };
  });

  const totals = perEmployee.reduce(
    (acc, r) => {
      acc.present += r.present_count;
      acc.late += r.late_count;
      acc.absent += r.absent_count;
      acc.leave += r.leave_count;
      return acc;
    },
    { present: 0, late: 0, absent: 0, leave: 0 }
  );

  return json({ from, to, per_employee: perEmployee, totals });
}
