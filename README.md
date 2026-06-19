# Household Expense Management

A Node-based web app for managing shared-house expenses, payments, payment requests, deadlines, audit logs, and printable monthly reports.

## Run

Install is not required because the app uses built-in Node modules only. Start the server:

```powershell
cmd /c npm start
```

Then visit:

```text
http://127.0.0.1:4173
```

On Windows, you can also double-click:

```text
start-local.bat
```

Default admin login:

```text
Username: admin
Password: admin123
```

## Notes

- Admin can create each member profile with a username and password.
- Passwords are stored as salted PBKDF2 hashes in the server data file.
- Data is saved in `data/data.json` locally.
- PDF export uses the browser print dialog. Choose "Save as PDF" when prompted.
- For production, set a stronger `ADMIN_PASSWORD` environment variable.

## Render Deployment

This repo includes `render.yaml`.

1. Push the project to GitHub.
2. In Render, choose **New +** then **Blueprint**.
3. Connect the repo and apply the `render.yaml`.
4. Change `ADMIN_PASSWORD` in Render environment variables after deploy.

The Render config mounts a 1 GB disk at `/var/data` and stores app data there through `DATA_DIR=/var/data`.
