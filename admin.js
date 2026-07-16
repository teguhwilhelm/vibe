let currentUser = null;
let cachedEmployees = [];
let cachedShifts = [];
let trendChartInstance = null;
let rateChartInstance = null;
let lateAbsChartInstance = null;

function todayStr() {
  return new Date().toLocaleDateString("en-CA");
}

async function boot() {
  currentUser = await requireSession("admin");
  if (!currentUser) return;
  document.getElementById("whoName").textContent = currentUser.name;
  document.getElementById("whoRole").textContent = "Admin";
  document.getElementById("sideMark").innerHTML =
    pulseMarkSVG(90, 22) + '<span class="wordmark">Vibe</span>';

  wireNav();
  document.getElementById("logoutBtn").onclick = async () => {
    await api("/auth/logout", { method: "POST" });
    location.href = "/";
  };
  document.getElementById("menuBtn").onclick = () =>
    document.getElementById("shell").classList.toggle("nav-open");

  document.getElementById("attDate").value = todayStr();
  const now = new Date();
  document.getElementById("repTo").value = todayStr();
  document.getElementById("repFrom").value = new Date(now.getFullYear(), now.getMonth(), 1)
    .toLocaleDateString("en-CA");

  await loadEmployees();
  await loadShifts();
  await loadLocations();
  await loadOverview();

  wireEmployees();
  wireScheduling();
  wireAttendance();
  wireLeave();
  wireReports();

  await loadAttendance();
  await loadLeave();
}

function wireNav() {
  const titles = {
    overview: ["Overview", "How the company is doing today."],
    employees: ["Employees", "Add, edit, or remove people from your company."],
    scheduling: ["Shifts & locations", "Manage shift templates, rotation, and approved work sites."],
    attendance: ["Attendance", "Daily, weekly, and monthly attendance records."],
    leave: ["Leave requests", "Review and decide on time-off requests."],
    reports: ["Reports", "Attendance rate, lateness, and absence trends."],
  };
  document.querySelectorAll(".nav-link[data-view]").forEach((link) => {
    link.addEventListener("click", async () => {
      document.querySelectorAll(".nav-link[data-view]").forEach((l) => l.classList.remove("active"));
      link.classList.add("active");
      Object.keys(titles).forEach((v) => {
        document.getElementById(`view-${v}`).style.display = v === link.dataset.view ? "block" : "none";
      });
      document.getElementById("pageTitle").textContent = titles[link.dataset.view][0];
      document.getElementById("pageSub").textContent = titles[link.dataset.view][1];
      document.getElementById("shell").classList.remove("nav-open");
      if (link.dataset.view === "reports") await loadReports();
    });
  });
}

// ===================== MODAL HELPER =====================

function openModal(title, bodyHtml, onSubmit, submitLabel = "Save") {
  const slot = document.getElementById("modalSlot");
  slot.innerHTML = `
    <div class="modal-overlay">
      <div class="modal">
        <h3>${title}</h3>
        <form id="modalForm">${bodyHtml}
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" id="modalCancel">Cancel</button>
            <button type="submit" class="btn btn-primary">${submitLabel}</button>
          </div>
        </form>
      </div>
    </div>`;
  const close = () => { slot.innerHTML = ""; };
  slot.querySelector("#modalCancel").onclick = close;
  slot.querySelector(".modal-overlay").addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-overlay")) close();
  });
  slot.querySelector("#modalForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await onSubmit(new FormData(e.target), e.target); close(); }
    catch (err) { toast(err.message, "error"); }
  });
}

// ===================== OVERVIEW =====================

async function loadOverview() {
  const today = todayStr();
  const { records } = await api(`/attendance?scope=day&date=${today}`);
  const { requests } = await api("/leave?status=pending");

  const present = records.filter((r) => r.status === "present").length;
  const late = records.filter((r) => r.status === "late").length;
  const absent = records.filter((r) => r.status === "absent").length;

  document.getElementById("statCards").innerHTML = `
    <div class="card stat-card"><div class="label">Present today</div><div class="value accent">${present}</div></div>
    <div class="card stat-card"><div class="label">Late today</div><div class="value warn">${late}</div></div>
    <div class="card stat-card"><div class="label">Absent today</div><div class="value danger">${absent}</div></div>
    <div class="card stat-card"><div class="label">Pending leave</div><div class="value">${requests.length}</div></div>`;

  // Last 7 days trend
  const labels = [];
  const rates = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dayStr = d.toLocaleDateString("en-CA");
    labels.push(d.toLocaleDateString([], { weekday: "short" }));
    const { records: dayRecords } = await api(`/attendance?scope=day&date=${dayStr}`);
    const worked = dayRecords.filter((r) => r.status === "present" || r.status === "late").length;
    const absentCount = dayRecords.filter((r) => r.status === "absent").length;
    const denom = worked + absentCount;
    rates.push(denom > 0 ? Math.round((worked / denom) * 100) : null);
  }

  const ctx = document.getElementById("trendChart");
  if (trendChartInstance) trendChartInstance.destroy();
  trendChartInstance = new Chart(ctx, {
    type: "line",
    data: { labels, datasets: [{ label: "Attendance rate %", data: rates, borderColor: "#3355ff",
      backgroundColor: "rgba(51,85,255,0.08)", fill: true, tension: 0.35, spanGaps: true }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100 } } },
  });
}

// ===================== EMPLOYEES =====================

async function loadEmployees() {
  const { employees } = await api("/employees");
  cachedEmployees = employees;
  const tbody = document.querySelector("#employeeTable tbody");
  tbody.innerHTML = employees.map((e) => `
    <tr>
      <td>${e.name}</td><td class="mono">${e.employee_code}</td><td>${e.email}</td>
      <td style="text-transform:capitalize;">${e.role}</td><td>${e.department || "—"}</td>
      <td><span class="badge badge-${e.status === "active" ? "approved" : "rejected"}">${e.status}</span></td>
      <td>
        <button class="btn btn-ghost btn-sm" data-edit="${e.id}">Edit</button>
        <button class="btn btn-danger-outline btn-sm" data-del="${e.id}">Delete</button>
      </td>
    </tr>`).join("") || `<tr><td colspan="7"><div class="empty-state">No employees yet. Add your first one.</div></td></tr>`;

  tbody.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => editEmployeeModal(b.dataset.edit));
  tbody.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => deleteEmployee(b.dataset.del));

  // Populate employee selects used elsewhere
  const rotSelect = document.getElementById("rotEmployee");
  if (rotSelect) rotSelect.innerHTML = employees.map((e) => `<option value="${e.id}">${e.name}</option>`).join("");
  const attSelect = document.getElementById("attEmployee");
  if (attSelect) attSelect.innerHTML = `<option value="">All employees</option>` +
    employees.map((e) => `<option value="${e.id}">${e.name}</option>`).join("");
}

function employeeFormHtml(e = {}) {
  return `
    <div class="field"><label>Full name</label><input name="name" required value="${e.name || ""}" /></div>
    <div class="field-row">
      <div class="field"><label>Employee code</label><input name="employee_code" required value="${e.employee_code || ""}" /></div>
      <div class="field"><label>Role</label>
        <select name="role"><option value="employee" ${e.role === "employee" || !e.role ? "selected" : ""}>Employee</option>
        <option value="admin" ${e.role === "admin" ? "selected" : ""}>Admin</option></select>
      </div>
    </div>
    <div class="field"><label>Email</label><input type="email" name="email" required value="${e.email || ""}" ${e.id ? "disabled" : ""} /></div>
    <div class="field-row">
      <div class="field"><label>Department</label><input name="department" value="${e.department || ""}" /></div>
      <div class="field"><label>Position</label><input name="position" value="${e.position || ""}" /></div>
    </div>
    ${e.id ? `<div class="field"><label>Status</label>
      <select name="status"><option value="active" ${e.status === "active" ? "selected" : ""}>Active</option>
      <option value="suspended" ${e.status === "suspended" ? "selected" : ""}>Suspended</option></select></div>` : ""}
    <div class="field"><label>${e.id ? "New password (optional)" : "Password"}</label>
      <input type="password" name="password" ${e.id ? "" : "required"} minlength="8" /></div>`;
}

function wireEmployees() {
  document.getElementById("addEmployeeBtn").onclick = () => {
    openModal("Add employee", employeeFormHtml(), async (fd) => {
      await api("/employees", { method: "POST", body: Object.fromEntries(fd) });
      toast("Employee added.", "success");
      await loadEmployees();
    }, "Add employee");
  };
}

function editEmployeeModal(id) {
  const emp = cachedEmployees.find((e) => e.id === id);
  openModal("Edit employee", employeeFormHtml(emp), async (fd) => {
    const body = Object.fromEntries(fd);
    delete body.email;
    if (!body.password) delete body.password;
    await api(`/employees/${id}`, { method: "PUT", body });
    toast("Employee updated.", "success");
    await loadEmployees();
  }, "Save changes");
}

async function deleteEmployee(id) {
  if (!confirm("Remove this employee? This cannot be undone.")) return;
  try {
    await api(`/employees/${id}`, { method: "DELETE" });
    toast("Employee removed.", "success");
    await loadEmployees();
  } catch (err) { toast(err.message, "error"); }
}

// ===================== SHIFTS & LOCATIONS =====================

async function loadShifts() {
  const { shifts } = await api("/shifts");
  cachedShifts = shifts;
  const tbody = document.querySelector("#shiftTable tbody");
  tbody.innerHTML = shifts.map((s) => `
    <tr><td>${s.name}</td><td class="mono">${s.start_time}–${s.end_time}</td><td>${s.grace_minutes}m</td>
    <td><button class="btn btn-danger-outline btn-sm" data-del-shift="${s.id}">Delete</button></td></tr>`
  ).join("") || `<tr><td colspan="4"><div class="empty-state">No shifts yet.</div></td></tr>`;
  tbody.querySelectorAll("[data-del-shift]").forEach((b) => b.onclick = async () => {
    if (!confirm("Delete this shift?")) return;
    await api(`/shifts/${b.dataset.delShift}`, { method: "DELETE" });
    await loadShifts();
  });

  const rotShifts = document.getElementById("rotShifts");
  if (rotShifts) rotShifts.innerHTML = shifts.map((s) => `<option value="${s.id}">${s.name} (${s.start_time}–${s.end_time})</option>`).join("");
}

async function loadLocations() {
  const { locations } = await api("/locations");
  const tbody = document.querySelector("#locationTable tbody");
  tbody.innerHTML = locations.map((l) => `
    <tr><td>${l.name}</td><td>${l.radius_meters}m</td>
    <td><button class="btn btn-danger-outline btn-sm" data-del-loc="${l.id}">Delete</button></td></tr>`
  ).join("") || `<tr><td colspan="3"><div class="empty-state">No approved locations yet — clock-in will be allowed from anywhere until you add one.</div></td></tr>`;
  tbody.querySelectorAll("[data-del-loc]").forEach((b) => b.onclick = async () => {
    if (!confirm("Delete this location?")) return;
    await api(`/locations/${b.dataset.delLoc}`, { method: "DELETE" });
    await loadLocations();
  });
}

function wireScheduling() {
  document.getElementById("addShiftBtn").onclick = () => {
    openModal("Add shift", `
      <div class="field"><label>Shift name</label><input name="name" required placeholder="Morning" /></div>
      <div class="field-row">
        <div class="field"><label>Start time</label><input type="time" name="start_time" required /></div>
        <div class="field"><label>End time</label><input type="time" name="end_time" required /></div>
      </div>
      <div class="field"><label>Grace period (minutes)</label><input type="number" name="grace_minutes" value="10" min="0" /></div>
    `, async (fd) => {
      await api("/shifts", { method: "POST", body: Object.fromEntries(fd) });
      toast("Shift added.", "success");
      await loadShifts();
    }, "Add shift");
  };

  document.getElementById("addLocationBtn").onclick = () => {
    openModal("Add work location", `
      <div class="field"><label>Location name</label><input name="name" required placeholder="Head Office" /></div>
      <div class="field-row">
        <div class="field"><label>Latitude</label><input type="number" step="any" name="latitude" required /></div>
        <div class="field"><label>Longitude</label><input type="number" step="any" name="longitude" required /></div>
      </div>
      <div class="field"><label>Allowed radius (meters)</label><input type="number" name="radius_meters" value="150" min="10" /></div>
      <div class="hint">Tip: open the location in Google Maps and copy the coordinates, or use "Use my current location" below.</div>
      <button type="button" class="btn btn-ghost btn-sm" id="useMyLoc" style="margin-top:8px;">📍 Use my current location</button>
    `, async (fd) => {
      const body = Object.fromEntries(fd);
      body.latitude = parseFloat(body.latitude);
      body.longitude = parseFloat(body.longitude);
      body.radius_meters = parseInt(body.radius_meters, 10);
      await api("/locations", { method: "POST", body });
      toast("Location added.", "success");
      await loadLocations();
    }, "Add location");

    setTimeout(() => {
      const btn = document.getElementById("useMyLoc");
      if (btn) btn.onclick = async () => {
        try {
          const { lat, lng } = await getLocation();
          document.querySelector('[name="latitude"]').value = lat;
          document.querySelector('[name="longitude"]').value = lng;
        } catch (err) { toast(err.message, "error"); }
      };
    }, 0);
  };

  document.getElementById("rotationForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const shiftIds = [...document.getElementById("rotShifts").selectedOptions].map((o) => o.value);
    if (!shiftIds.length) return toast("Select at least one shift.", "error");
    try {
      await api("/shifts/assign-rotation", {
        method: "POST",
        body: {
          user_id: document.getElementById("rotEmployee").value,
          shift_ids: shiftIds,
          interval_days: parseInt(document.getElementById("rotInterval").value, 10),
          start_date: document.getElementById("rotStart").value,
        },
      });
      toast("Rotation saved.", "success");
    } catch (err) { toast(err.message, "error"); }
  });
}

// ===================== ATTENDANCE =====================

let attScope = "day";
let lastAttendanceRows = [];
function wireAttendance() {
  document.querySelectorAll("#attScopeTabs button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#attScopeTabs button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      attScope = btn.dataset.scope;
      loadAttendance();
    });
  });
  document.getElementById("attDate").addEventListener("change", loadAttendance);
  document.getElementById("attEmployee").addEventListener("change", loadAttendance);

  document.getElementById("attExportExcel").onclick = () => exportRowsExcel(lastAttendanceRows.map((r) => ({
    Employee: r.user_name, Code: r.employee_code, Date: r.date, Shift: r.shift_name || "",
    "Clock In": r.clock_in_at || "", "Clock Out": r.clock_out_at || "", Status: r.status,
  })), "vibe-attendance");

  document.getElementById("attExportPdf").onclick = () => exportRowsPdf(
    "Vibe — Attendance Report",
    ["Employee", "Date", "Shift", "Clock In", "Clock Out", "Status"],
    lastAttendanceRows.map((r) => [r.user_name, r.date, r.shift_name || "—", fmtTime(r.clock_in_at), fmtTime(r.clock_out_at), r.status]),
    "vibe-attendance"
  );
}

async function loadAttendance() {
  const date = document.getElementById("attDate").value || todayStr();
  const userId = document.getElementById("attEmployee").value;
  const qs = new URLSearchParams({ scope: attScope, date });
  if (userId) qs.set("user_id", userId);
  const { records } = await api(`/attendance?${qs.toString()}`);
  lastAttendanceRows = records;
  const tbody = document.querySelector("#attendanceTable tbody");
  tbody.innerHTML = records.length ? records.map((r) => `
    <tr>
      <td>${r.user_name} <span class="mono" style="color:var(--muted);">(${r.employee_code})</span></td>
      <td>${fmtDate(r.date)}</td><td>${r.shift_name || "—"}</td>
      <td class="mono">${fmtTime(r.clock_in_at)}</td><td class="mono">${fmtTime(r.clock_out_at)}</td>
      <td>${badge(r.status)}</td>
    </tr>`).join("") : `<tr><td colspan="6"><div class="empty-state">No attendance records for this period.</div></td></tr>`;
}

// ===================== LEAVE =====================

let leaveStatusFilter = "pending";
function wireLeave() {
  document.querySelectorAll("#leaveStatusTabs button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#leaveStatusTabs button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      leaveStatusFilter = btn.dataset.status;
      loadLeave();
    });
  });
}

async function loadLeave() {
  const qs = leaveStatusFilter ? `?status=${leaveStatusFilter}` : "";
  const { requests } = await api(`/leave${qs}`);
  const tbody = document.querySelector("#leaveTable tbody");
  tbody.innerHTML = requests.length ? requests.map((r) => `
    <tr>
      <td>${r.user_name} <span class="mono" style="color:var(--muted);">(${r.employee_code})</span></td>
      <td style="text-transform:capitalize;">${r.leave_type}</td>
      <td>${fmtDate(r.start_date)} – ${fmtDate(r.end_date)}</td>
      <td>${r.reason || "—"}</td>
      <td>${badge(r.status)}</td>
      <td>${r.status === "pending" ? `
        <button class="btn btn-primary btn-sm" data-approve="${r.id}">Approve</button>
        <button class="btn btn-danger-outline btn-sm" data-reject="${r.id}">Reject</button>` : ""}</td>
    </tr>`).join("") : `<tr><td colspan="6"><div class="empty-state">No leave requests here.</div></td></tr>`;

  tbody.querySelectorAll("[data-approve]").forEach((b) => b.onclick = () => decideLeave(b.dataset.approve, "approved"));
  tbody.querySelectorAll("[data-reject]").forEach((b) => b.onclick = () => decideLeave(b.dataset.reject, "rejected"));
}

async function decideLeave(id, status) {
  try {
    await api(`/leave/${id}`, { method: "PUT", body: { status } });
    toast(`Request ${status}.`, "success");
    await loadLeave();
  } catch (err) { toast(err.message, "error"); }
}

// ===================== REPORTS =====================

function wireReports() {
  document.getElementById("repRun").onclick = loadReports;
  document.getElementById("repExportExcel").onclick = () => exportRowsExcel(lastReportRows.map((r) => ({
    Employee: r.name, Code: r.employee_code, Present: r.present_count, Late: r.late_count,
    Absent: r.absent_count, Leave: r.leave_count, "Rate %": r.attendance_rate ?? "",
  })), "vibe-report");
  document.getElementById("repExportPdf").onclick = () => exportRowsPdf(
    "Vibe — Attendance Report",
    ["Employee", "Present", "Late", "Absent", "Leave", "Rate %"],
    lastReportRows.map((r) => [r.name, r.present_count, r.late_count, r.absent_count, r.leave_count, r.attendance_rate ?? "—"]),
    "vibe-report"
  );
}

let lastReportRows = [];
async function loadReports() {
  const from = document.getElementById("repFrom").value;
  const to = document.getElementById("repTo").value;
  const { per_employee, totals } = await api(`/reports/summary?from=${from}&to=${to}`);
  lastReportRows = per_employee;

  const tbody = document.querySelector("#reportTable tbody");
  tbody.innerHTML = per_employee.length ? per_employee.map((r) => `
    <tr><td>${r.name}</td><td>${r.present_count}</td><td>${r.late_count}</td>
    <td>${r.absent_count}</td><td>${r.leave_count}</td>
    <td>${r.attendance_rate !== null ? r.attendance_rate + "%" : "—"}</td></tr>`).join("")
    : `<tr><td colspan="6"><div class="empty-state">No data in this range.</div></td></tr>`;

  const rateCtx = document.getElementById("rateChart");
  if (rateChartInstance) rateChartInstance.destroy();
  const worked = totals.present + totals.late;
  const denom = worked + totals.absent;
  rateChartInstance = new Chart(rateCtx, {
    type: "doughnut",
    data: {
      labels: ["On time", "Late", "Absent", "Leave"],
      datasets: [{ data: [totals.present, totals.late, totals.absent, totals.leave],
        backgroundColor: ["#16c79a", "#ffb020", "#ef4444", "#3355ff"] }],
    },
    options: { plugins: { legend: { position: "bottom" } } },
  });

  const laCtx = document.getElementById("lateAbsChart");
  if (lateAbsChartInstance) lateAbsChartInstance.destroy();
  lateAbsChartInstance = new Chart(laCtx, {
    type: "bar",
    data: {
      labels: per_employee.map((r) => r.name),
      datasets: [
        { label: "Late", data: per_employee.map((r) => r.late_count), backgroundColor: "#ffb020" },
        { label: "Absent", data: per_employee.map((r) => r.absent_count), backgroundColor: "#ef4444" },
      ],
    },
    options: { scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } } },
  });
}

// ===================== EXPORT HELPERS =====================

function exportRowsExcel(rows, filenamePrefix) {
  if (!rows.length) return toast("Nothing to export yet.", "error");
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  XLSX.writeFile(wb, `${filenamePrefix}-${todayStr()}.xlsx`);
}

function exportRowsPdf(title, head, body, filenamePrefix) {
  if (!body.length) return toast("Nothing to export yet.", "error");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.text(title, 14, 16);
  doc.autoTable({ startY: 22, head: [head], body });
  doc.save(`${filenamePrefix}-${todayStr()}.pdf`);
}

boot();
