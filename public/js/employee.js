let currentUser = null;
let todayRecord = null;

function todayStr() {
  const d = new Date();
  return d.toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
}

async function boot() {
  currentUser = await requireSession("employee");
  if (!currentUser) return;
  document.getElementById("whoName").textContent = currentUser.name;
  document.getElementById("whoRole").textContent = currentUser.employee_code || "Employee";
  document.getElementById("sideMark").innerHTML =
    pulseMarkSVG(90, 22) + '<span class="wordmark">Vibe</span>';

  wireNav();
  wireClock();
  wireHistory();
  wireLeave();
  wireExports();

  tickClock();
  setInterval(tickClock, 1000);
  await refreshTodayStatus();
  await loadShiftInfo();
  await loadWeekMini();
  await loadHistory();
  await loadLeave();

  document.getElementById("logoutBtn").onclick = async () => {
    await api("/auth/logout", { method: "POST" });
    location.href = "/";
  };
  document.getElementById("menuBtn").onclick = () =>
    document.getElementById("shell").classList.toggle("nav-open");
}

function wireNav() {
  document.querySelectorAll(".nav-link[data-view]").forEach((link) => {
    link.addEventListener("click", () => {
      document.querySelectorAll(".nav-link[data-view]").forEach((l) => l.classList.remove("active"));
      link.classList.add("active");
      ["home", "history", "leave"].forEach((v) => {
        document.getElementById(`view-${v}`).style.display = v === link.dataset.view ? "block" : "none";
      });
      const titles = { home: ["Good to see you", "Here's your attendance at a glance."],
        history: ["Attendance history", "Browse your daily, weekly, and monthly records."],
        leave: ["Leave", "Request time off and track approvals."] };
      document.getElementById("pageTitle").textContent = titles[link.dataset.view][0];
      document.getElementById("pageSub").textContent = titles[link.dataset.view][1];
      document.getElementById("shell").classList.remove("nav-open");
    });
  });
}

function tickClock() {
  const now = new Date();
  document.getElementById("clockTime").textContent = now.toLocaleTimeString([], { hour12: false });
  document.getElementById("clockDate").textContent = now.toLocaleDateString([], {
    weekday: "long", month: "long", day: "numeric",
  });
}

async function refreshTodayStatus() {
  const { records } = await api(`/attendance?scope=day&date=${todayStr()}`);
  todayRecord = records[0] || null;
  const statusLine = document.getElementById("statusLine");
  const inBtn = document.getElementById("btnClockIn");
  const outBtn = document.getElementById("btnClockOut");

  if (!todayRecord || !todayRecord.clock_in_at) {
    statusLine.textContent = "You haven't clocked in yet today.";
    inBtn.disabled = false; outBtn.disabled = true;
  } else if (!todayRecord.clock_out_at) {
    statusLine.innerHTML = `Clocked in at <span class="mono">${fmtTime(todayRecord.clock_in_at)}</span> · ${badge(todayRecord.status)}`;
    inBtn.disabled = true; outBtn.disabled = false;
  } else {
    statusLine.innerHTML = `Done for today — in <span class="mono">${fmtTime(todayRecord.clock_in_at)}</span>, out <span class="mono">${fmtTime(todayRecord.clock_out_at)}</span>`;
    inBtn.disabled = true; outBtn.disabled = true;
  }
}

function wireClock() {
  document.getElementById("btnClockIn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = "Finding you…";
    try {
      const { lat, lng } = await getLocation();
      await api("/attendance/clock-in", { method: "POST", body: { lat, lng, date: todayStr() } });
      toast("Clocked in. Have a great day!", "success");
      await refreshTodayStatus();
      await loadHistory();
    } catch (err) { toast(err.message, "error"); btn.disabled = false; }
    finally { btn.textContent = "Clock in"; }
  });

  document.getElementById("btnClockOut").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = "Finding you…";
    try {
      const { lat, lng } = await getLocation();
      await api("/attendance/clock-out", { method: "POST", body: { lat, lng, date: todayStr() } });
      toast("Clocked out. See you tomorrow.", "success");
      await refreshTodayStatus();
      await loadHistory();
    } catch (err) { toast(err.message, "error"); btn.disabled = false; }
    finally { btn.textContent = "Clock out"; }
  });
}

async function loadShiftInfo() {
  const box = document.getElementById("shiftInfo");
  try {
    const { shift } = await api(`/shifts/today?date=${todayStr()}`);
    box.innerHTML = shift
      ? `<div style="font-size:20px;font-weight:700;font-family:var(--font-display);">${shift.name}</div>
         <div class="mono" style="color:var(--muted);margin-top:4px;">${shift.start_time} – ${shift.end_time}</div>`
      : `<div>No shift is scheduled for you today.</div>`;
  } catch { box.textContent = "Couldn't load shift info."; }
}

async function loadWeekMini() {
  const { records } = await api(`/attendance?scope=week&date=${todayStr()}`);
  const box = document.getElementById("weekMini");
  if (!records.length) { box.innerHTML = `<div class="empty-state">No records yet this week.</div>`; return; }
  box.innerHTML = `<table><tbody>${records
    .map((r) => `<tr><td>${fmtDate(r.date)}</td><td>${badge(r.status)}</td></tr>`)
    .join("")}</tbody></table>`;
}

let historyScope = "day";
function wireHistory() {
  document.getElementById("historyDate").value = todayStr();
  document.querySelectorAll("#scopeTabs button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#scopeTabs button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      historyScope = btn.dataset.scope;
      loadHistory();
    });
  });
  document.getElementById("historyDate").addEventListener("change", loadHistory);
}

let lastHistoryRows = [];
async function loadHistory() {
  const date = document.getElementById("historyDate").value || todayStr();
  const { records } = await api(`/attendance?scope=${historyScope}&date=${date}`);
  lastHistoryRows = records;
  const tbody = document.querySelector("#historyTable tbody");
  tbody.innerHTML = records.length
    ? records.map((r) => `<tr>
        <td>${fmtDate(r.date)}</td>
        <td>${r.shift_name || "—"}</td>
        <td class="mono">${fmtTime(r.clock_in_at)}</td>
        <td class="mono">${fmtTime(r.clock_out_at)}</td>
        <td>${badge(r.status)}</td>
      </tr>`).join("")
    : `<tr><td colspan="5"><div class="empty-state"><div class="glyph">📭</div>No attendance records for this period.</div></td></tr>`;
}

function wireLeave() {
  document.getElementById("leaveForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/leave", {
        method: "POST",
        body: {
          leave_type: document.getElementById("leaveType").value,
          start_date: document.getElementById("leaveStart").value,
          end_date: document.getElementById("leaveEnd").value,
          reason: document.getElementById("leaveReason").value,
        },
      });
      toast("Leave request submitted.", "success");
      e.target.reset();
      await loadLeave();
    } catch (err) { toast(err.message, "error"); }
  });
}

async function loadLeave() {
  const { requests } = await api("/leave");
  const tbody = document.querySelector("#leaveTable tbody");
  tbody.innerHTML = requests.length
    ? requests.map((r) => `<tr>
        <td style="text-transform:capitalize;">${r.leave_type}</td>
        <td>${fmtDate(r.start_date)} – ${fmtDate(r.end_date)}</td>
        <td>${badge(r.status)}</td>
      </tr>`).join("")
    : `<tr><td colspan="3"><div class="empty-state">No leave requests yet.</div></td></tr>`;
}

function wireExports() {
  document.getElementById("exportExcel").addEventListener("click", () => {
    if (!lastHistoryRows.length) return toast("Nothing to export yet.", "error");
    const rows = lastHistoryRows.map((r) => ({
      Date: r.date, Shift: r.shift_name || "", "Clock In": r.clock_in_at || "",
      "Clock Out": r.clock_out_at || "", Status: r.status,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Attendance");
    XLSX.writeFile(wb, `vibe-attendance-${todayStr()}.xlsx`);
  });

  document.getElementById("exportPdf").addEventListener("click", () => {
    if (!lastHistoryRows.length) return toast("Nothing to export yet.", "error");
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text("Vibe — Attendance Report", 14, 16);
    doc.autoTable({
      startY: 22,
      head: [["Date", "Shift", "Clock In", "Clock Out", "Status"]],
      body: lastHistoryRows.map((r) => [
        r.date, r.shift_name || "—", fmtTime(r.clock_in_at), fmtTime(r.clock_out_at), r.status,
      ]),
    });
    doc.save(`vibe-attendance-${todayStr()}.pdf`);
  });
}

boot();
