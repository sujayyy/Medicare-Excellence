# Medicare Excellence

Combined monorepo for the Medicare Excellence healthcare MVP.

## Project structure

- `backend/` - Flask + MongoDB API
- `frontend/` - React + Vite web app

## What your friend needs

- Git
- Node.js 20 LTS
- Python 3.11+
- MongoDB Community Server

## Windows setup

### 1. Clone the repo

```powershell
git clone <YOUR-NEW-REPO-URL> Medicare-Excellence
cd Medicare-Excellence
```

### 2. Start MongoDB

Install MongoDB Community Server and make sure the MongoDB service is running locally on:

- `mongodb://127.0.0.1:27017/`

### 3. Backend setup

```powershell
cd backend
copy .env.example .env
py -3 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python app.py
```

Recommended backend `.env`:

```env
FLASK_SECRET_KEY=change-this-secret
FLASK_DEBUG=true
PORT=5001
MONGO_URI=mongodb://127.0.0.1:27017/
MONGO_DB_NAME=MediBotDB
```

Backend runs at:

- `http://127.0.0.1:5001`

### 4. Frontend setup

Open a second PowerShell window:

```powershell
cd Medicare-Excellence\frontend
copy .env.example .env
npm install
npm run dev
```

Recommended frontend `.env`:

```env
VITE_API_BASE_URL=http://127.0.0.1:5001
VITE_WHATSAPP_NUMBER=919999999999
```

Frontend runs at:

- `http://127.0.0.1:8080`

## Test accounts

Create users from the signup page as:

- `patient`
- `doctor`
- `hospital_admin`

For `doctor`, choose the correct specialty because patient routing and alerts are specialty-aware.

## Notes

- Backend and frontend are already configured to work together locally.
- Do not commit `.env`, `node_modules`, `dist`, or `.venv`.
- If you prefer MongoDB Atlas, replace `MONGO_URI` in `backend/.env`.
