# Medicare Excellence Backend

Flask + MongoDB backend for the Medicare Excellence healthcare MVP.

## Run locally

### macOS / Linux

```bash
cd /Users/ivar/AI-MediApp:/Medi-Bot
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 app.py
```

### Windows PowerShell

```powershell
cd C:\path\to\Medi-Bot
py -3 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python app.py
```

Copy `.env.example` to `.env` and set:

- `FLASK_SECRET_KEY`
- `MONGO_URI`
- `MONGO_DB_NAME`
- `PORT`

Default API:

- `http://127.0.0.1:5001`

If MongoDB is installed locally, keep:

- `MONGO_URI=mongodb://127.0.0.1:27017/`

If you use MongoDB Atlas instead, replace `MONGO_URI` with your Atlas connection string.

## Main API groups

- Auth: `/signup`, `/login`, `/me`
- Chat: `/chat`, `/chat/history`
- Admin: `/stats`, `/patients`, `/emergencies`, `/alerts`, `/analytics/overview`
- Documents: `/documents`
- Vitals: `/vitals`
