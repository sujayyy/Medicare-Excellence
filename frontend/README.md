# Medicare Excellence Frontend

React + Vite frontend for the Medicare Excellence healthcare MVP.

## Run locally

### macOS / Linux

```bash
cd /Users/ivar/AI-MediApp:/curecraft-ai
npm install
npm run dev
```

### Windows PowerShell

```powershell
cd C:\path\to\curecraft-ai
npm install
npm run dev
```

Copy `.env.example` to `.env` and set:

- `VITE_API_BASE_URL`
- `VITE_WHATSAPP_NUMBER`

Default app URL:

- `http://127.0.0.1:8080`

Backend default:

- `VITE_API_BASE_URL=http://127.0.0.1:5001`

## Main workspaces

- `/patient`
- `/doctor`
- `/admin`
- `/analytics`

## Stack

- React
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui
- TanStack Query
