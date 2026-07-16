const API_BASE = "/api";

async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function toast(message, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

function pulseMarkSVG(width = 132, height = 28, stroke = "currentColor") {
  return `<svg width="${width}" height="${height}" viewBox="0 0 132 28" fill="none">
    <path class="pulse-line" d="M2 14 H30 L38 3 L48 25 L56 14 H70 L76 6 L84 22 L90 14 H130"
      stroke="${stroke}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function badge(status) {
  const map = {
    present: "Present", late: "Late", absent: "Absent", leave: "Leave",
    pending: "Pending", approved: "Approved", rejected: "Rejected",
  };
  return `<span class="badge badge-${status}">${map[status] || status}</span>`;
}

function fmtTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr + "T00:00:00").toLocaleDateString([], {
    month: "short", day: "numeric", year: "numeric",
  });
}

function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Geolocation isn't available on this device."));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => reject(new Error("Location access was denied. Enable it to clock in or out.")),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

async function requireSession(role) {
  try {
    const { user } = await api("/auth/me");
    if (!user) { location.href = "/"; return null; }
    if (role && user.role !== role) {
      location.href = user.role === "admin" ? "/admin.html" : "/employee.html";
      return null;
    }
    return user;
  } catch {
    location.href = "/";
    return null;
  }
}
