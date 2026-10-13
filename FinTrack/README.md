# FinTrack — Premium Finance Dashboard + Admin Control Panel

A full-stack demo finance application built with React, Vite, Express, MongoDB/Mongoose, JWT authentication, and a premium dark responsive UI.

## Demo accounts

Run the seed commands below to create these fictional demo accounts and 1,000 transactions for each account (2,000 transactions total):

| Role | Username | Email | Password |
|---|---|---|---|
| Administrator | `admin` | `admin@fintrack.local` | `Admin@123456` |
| Demo user 1 | `lily` | `lily@fintrack.local` | `Lily@Fintrack123` |
| Demo user 2 | `noah` | `noah@fintrack.local` | `Noah@Fintrack123` |

These are local demo credentials only. Change them before exposing the app to a network. Passwords are stored as bcrypt hashes, not plaintext. Demo users are fictional and all transaction/investment data is synthetic.

## Features

- Signup, login by username/email, logout, password reset, password hashing, JWT sessions, failed-login lockout
- Premium responsive dashboard with animated metrics, interactive cash-flow charts, command palette (`Ctrl/Cmd + K`), notifications and transitions
- Transactions, category budgets, savings goals, manually tracked investments, bills, reports, settings, and CSV exports
- Admin control panel with platform-wide metrics, all users/accounts, all recorded transactions, investment holdings, activity/audit timeline, CSV exports, suspend/reactivate, role controls
- Explicit **Sign out / switch account** button inside the admin control panel, plus logout in the sidebar, so you can return to login and switch between admin, Lily, and Noah
- `npm run demo:seed` provisions two demo users and replaces their demo records with exactly 1,000 transactions each, plus budgets, goals, investments, and bills
- Per-user data isolation in ordinary finance routes; admin routes enforce the admin role on the server
- Activity log records successful authenticated writes and sign-in outcomes without storing passwords/request bodies

> Scope: educational demo, not a bank. It does not connect to bank rails, move real money, or fetch live brokerage values. Financial balances are calculated from synthetic/user-entered records. Review security and add MFA, email verification, deployment secrets, HTTPS, backups, and compliance controls before production use.

## Requirements

- Node.js 20+ (Node 22 LTS recommended)
- MongoDB Community running locally or a MongoDB Atlas URI
- VS Code or another editor

## Windows Command Prompt (CMD) setup

1. Extract the ZIP, open **Command Prompt** (not PowerShell), and `cd` to the extracted inner `FinTrack` folder. Example:
   ```cmd
   cd /d "%USERPROFILE%\Downloads\FinTrack-Admin-Control-Panel\FinTrack"
   ```
2. Create the environment file if it doesn't exist:
   ```cmd
   if not exist server\.env copy server\.env.example server\.env
   ```
3. Open `server\.env` and check `MONGODB_URI`. Local MongoDB default:
   `mongodb://127.0.0.1:27017/fintrack`
   Keep `ADMIN_USERNAME=admin`, `ADMIN_EMAIL=admin@fintrack.local`, and `ADMIN_PASSWORD=Admin@123456` for the local demo. Set `JWT_SECRET` to a long random secret. Do not commit `.env`.
4. Install dependencies:
   ```cmd
   npm install
   ```
5. Ensure MongoDB is running. Seed the admin account first:
   ```cmd
   npm run admin:seed
   ```
6. Seed the two demo users and 1,000 transactions per user:
   ```cmd
   npm run demo:seed
   ```
   This command is repeatable, but it deletes/recreates the demo records for `lily` and `noah` and resets their passwords to the demo defaults above. Do not run it if you want to preserve edits made to those demo accounts.
7. Start frontend and API together:
   ```cmd
   npm run dev
   ```
8. Open `http://localhost:5173/login`. Use the credentials table above. The API health endpoint is `http://localhost:5000/api/health`.

## Switching accounts

While logged in, use **Sign out / switch account** in the admin control panel's right-hand admin card, or the logout icon at the bottom of the sidebar. You will return to `/login`. Enter `lily` or `noah` with their password to see each separate user's dashboard. Sign in as `admin` again to return to platform-wide admin monitoring.

## Environment variables

See `server/.env.example`. `ADMIN_USERNAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` are used by `npm run admin:seed`. `DEMO_USER1_PASSWORD` and `DEMO_USER2_PASSWORD` optionally override demo user passwords when running `npm run demo:seed`.

## API overview

- `POST /api/auth/signup`, `POST /api/auth/login`, `GET /api/auth/me`
- `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`
- `GET /api/overview`
- `GET/POST /api/transactions`, `PATCH/DELETE /api/transactions/:id`
- Budgets, goals, investments, bills, reports and settings endpoints
- `GET /api/admin/overview`, `GET /api/admin/users`, `PATCH /api/admin/users/:id`, `GET /api/admin/transactions`, `GET /api/admin/investments`, `GET /api/admin/activity`

Without SMTP settings, password reset returns a one-time development link. To send real emails, configure SMTP values in `server/.env`.


## Login/logout troubleshooting and verification

- Open `http://localhost:5173/login` after `npm run dev` starts both services.
- Login accepts either the username (`admin`, `lily`, `noah`) or the corresponding email.
- Admin login opens `/admin`; demo user login opens `/dashboard`.
- Use **Sign out / switch account** in the admin hero card or the sign-out icon at the bottom of the sidebar. It clears the saved JWT and replaces the route with `/login`.
- After logout, try opening `http://localhost:5173/admin` directly. You should be redirected to `/login`.
- If the page shows an API error, check `http://localhost:5000/api/health` and verify MongoDB is running and `server/.env` has a valid `MONGODB_URI` and `JWT_SECRET`.
- The seed command creates exactly 1,000 synthetic transactions for Lily and 1,000 for Noah. It deletes and recreates only their demo records when rerun; do not rerun if you want to preserve edits to those demo accounts.

## VS Code quick setup (Windows)

1. Install Node.js 20 or newer and MongoDB Community Server, or create a MongoDB Atlas database.
2. Extract this ZIP and open the inner `FinTrack` folder in VS Code (**File → Open Folder**).
3. Open **Terminal → New Terminal** and use Command Prompt for the commands below.
4. Run `if not exist server\.env copy server\.env.example server\.env`.
5. Open `server/.env`; set `MONGODB_URI` to your local or Atlas connection string and replace `JWT_SECRET` with a long random secret.
6. Run `npm install`.
7. Ensure MongoDB is running, then run `npm run admin:seed`.
8. Run `npm run demo:seed`.
9. Run `npm run build` to build the frontend.
10. Run `npm run dev` and visit `http://localhost:5173/login`.

Expected demo credentials: `admin` / `Admin@123456`, `lily` / `Lily@Fintrack123`, `noah` / `Noah@Fintrack123`.

## Hosted deployment (recommended: Render)

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for the Render Blueprint, MongoDB Atlas setup, production secrets, one-time seed steps, and the safe redeploy/data-persistence workflow. The production build serves the React app and API from one Render service, and the client uses same-origin `/api` requests.

**Persistence rule:** use MongoDB Atlas (or another managed persistent MongoDB service) and retain the same `MONGODB_URI`. Run `npm run admin:seed` and `npm run demo:seed` only once for a fresh database. The demo seed replaces Lily and Noah's demo records when rerun.
