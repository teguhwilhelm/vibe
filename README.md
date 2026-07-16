# Vibe: Virtual Attendance & Business Efficiency

A serverless employee attendance application — GPS-verified clock-in/out, shift
rotation, leave management, employee records, and reporting with charts and
Excel/PDF export. Runs entirely on **Cloudflare Pages** (static frontend +
Pages Functions API) and **Cloudflare D1** (SQLite database). No servers to
manage, no separate backend host.

## What's included

- `public/` — the frontend (plain HTML/CSS/JS, no build step)
  - `index.html` — sign in / create a company workspace
  - `employee.html` + `js/employee.js` — clock in/out, personal history, leave requests
  - `admin.html` + `js/admin.js` — employee management, shifts & locations,
    attendance records, leave approvals, reports & charts, exports
- `functions/api/[[route]].js` — the entire API, as a Cloudflare Pages Function
- `functions/lib/` — shared server helpers (password hashing, sessions, geofencing, rotation math)
- `schema.sql` — the D1 database schema
- `wrangler.toml` — Cloudflare configuration (Pages + D1 binding)

## Features

| Feature | How it works |
|---|---|
| Clock in/out with timestamps | `attendance` table records exact clock-in/out times per employee per day |
| GPS verification | Browser geolocation is checked against your configured work location(s) and allowed radius before a clock-in/out is accepted |
| Shift management & auto-rotation | Admins define shifts (e.g. Morning/Afternoon/Night); assign an employee a rotation order and interval, and the app computes their shift for any date automatically |
| Leave management | Employees submit requests; admins approve/reject; approved days are marked on the attendance record |
| Employee data management | Admins add, edit, suspend, or delete employee records |
| Attendance history | Day/week/month views, personal and company-wide |
| Reports & charts | Attendance rate, lateness, and absence charts (Chart.js), company + per-employee |
| Roles | `admin` and `employee` accounts, enforced on every API route |
| Data export | Excel (SheetJS) and PDF (jsPDF) export, generated client-side from the same data shown on screen |
| Multi-tenant | Each signup creates its own `company`; every table is scoped by `company_id`, so one deployment can serve many businesses, or you can run it for just your own |

## 1. Prerequisites

- A free [Cloudflare account](https://dash.cloudflare.com/sign-up)
- A [GitHub account](https://github.com)
- [Node.js](https://nodejs.org) 18+ installed locally (for the `wrangler` CLI)

## 2. Push this project to GitHub

```bash
cd vibe-attendance
git init
git add .
git commit -m "Initial commit: Vibe attendance app"
git branch -M main
git remote add origin https://github.com/<your-username>/vibe-attendance.git
git push -u origin main
```

## 3. Create the D1 database

```bash
npm install -g wrangler   # if you don't already have it
wrangler login
wrangler d1 create vibe_attendance_db
```

Copy the `database_id` it prints out, and paste it into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "vibe_attendance_db"
database_id = "PASTE_YOUR_ID_HERE"
```

Load the schema:

```bash
wrangler d1 execute vibe_attendance_db --remote --file=./schema.sql
```

(Use `--local` instead of `--remote` if you want to try it locally first with `npm run dev`.)

## 4. Create the Cloudflare Pages project

1. In the Cloudflare dashboard, go to **Workers & Pages → Create → Pages → Connect to Git**.
2. Select your `vibe-attendance` repo.
3. Build settings:
   - **Framework preset:** None
   - **Build command:** *(leave blank)*
   - **Build output directory:** `public`
4. Deploy. Cloudflare will pick up `functions/api/[[route]].js` automatically as your API.

## 5. Bind the D1 database to Pages

1. Open your new Pages project → **Settings → Functions → D1 database bindings**.
2. Add a binding: **Variable name** `DB`, **D1 database** `vibe_attendance_db`.
3. Redeploy (Settings changes require a new deployment to take effect — trigger one from **Deployments → Retry deployment** or push any commit).

## 6. Try it

Open your `*.pages.dev` URL (or your custom domain once attached):

1. Click **Start a company**, fill in your company name and your own admin details. This creates your tenant and logs you in as the first admin.
2. As admin: add a work location (use the "Use my current location" button while you're on-site), add shifts, add employees, and optionally set up a rotation.
3. Employees sign in at the same URL and use **Clock in / Clock out** on their dashboard — the browser will ask for location permission the first time.

## Notes & things to configure further

- **Time zone / lateness:** lateness is computed by comparing the clock-in time of day against the shift's start time plus its grace period, using each visitor's local device clock. For a distributed team across time zones, consider standardizing shift times per location or extending `functions/lib/geo.js` to convert using the company's stored `timezone`.
- **Cron-based rotation materialization:** the app computes an employee's rotating shift on demand (when they view their dashboard or clock in), and saves it to `shift_assignments` at that point. If you want tomorrow's shifts pre-populated before anyone logs in, add a small scheduled Worker that calls `GET /api/shifts/today?user_id=...&date=...` for each employee, or ask to have this added as a Cron Trigger.
- **Custom domain:** attach one under Pages → Custom domains once you're ready to go live.
- **Backups:** D1 supports point-in-time recovery and `wrangler d1 export` for manual backups — worth scheduling periodically since this is your system of record for attendance.
