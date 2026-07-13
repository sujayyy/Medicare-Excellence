# Medicare Excellence

[![Backend tests](https://github.com/sujayyy/Medicare-Excellence/actions/workflows/backend-tests.yml/badge.svg)](https://github.com/sujayyy/Medicare-Excellence/actions/workflows/backend-tests.yml)

AI-powered hospital coordination platform for patient triage, clinician review, and hospital operations.

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
git clone https://github.com/sujayyy/Medicare-Excellence.git
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

## Share on another device

If you want to open the app on another laptop or phone during demo:

1. Keep the backend running on `5001`
2. Start the frontend on `8080`
3. Run:

```bash
ngrok http 8080
```

4. Share the generated `https://...ngrok-free.app` frontend URL

The frontend now proxies API calls through `/api`, so you only need to share one frontend URL during development.

## Test accounts

Create users from the signup page as:

- `patient`
- `doctor`
- `hospital_admin`

For `doctor`, choose the correct specialty because patient routing and alerts are specialty-aware.

## Testing & evaluation

### Running the backend test suite

Requires a local MongoDB running on `mongodb://127.0.0.1:27017/` (tests use an isolated
`MediBotDB_test` database, dropped after each test).

```bash
cd backend
pip install -r requirements-dev.txt
pytest tests/ -v --cov=services --cov=models --cov=routes
```

31 tests cover triage scoring (`services/triage_service.py`), specialty routing
(`services/doctor_routing_service.py`), and the auth API end-to-end (signup/login/me)
against a real database. Coverage: 96%+ on the triage/routing logic files, 56% on
`routes/auth.py`, ~28% across the whole backend (most non-auth routes and AI services
aren't covered yet).

CI runs this suite automatically on every push via `.github/workflows/backend-tests.yml`,
against a fresh MongoDB service container.

### Triage/specialty model evaluation

`services/triage_eval_dataset.py` holds 105 independently-labeled, diverse synthetic
examples (not copies of the phrase-matching keyword lists) used to score the triage and
specialty classifiers. Run it with:

```bash
python -c "from services.model_intelligence_service import evaluate_model_stack; import json; print(json.dumps(evaluate_model_stack(), indent=2))"
```

Honest results on this dataset (hashing-vectorizer embedding backend, no `GEMINI_API_KEY` set):

| Metric | Value |
|---|---|
| Triage accuracy | 0.419 |
| Triage macro-F1 | 0.33 |
| Specialty accuracy | 0.714 |

**Known limitation**: on diverse phrasing, the classifier correctly recalled only 2 of 20
"Critical" test cases (10%) — it relies on exact-substring phrase matching (e.g.
`"cannot breathe"`) and misses paraphrases like `"can't breathe"` or indirect language like
overdose descriptions. This is a real gap, not a false-negative-free system — treat the
`triage_label` output as a decision-support signal, not a substitute for clinical judgment.

The model is labeled `rule-embedding-hybrid-triage-v1` / `rule-embedding-hybrid-specialty-v1`
because that's what it actually is: phrase/entity rule scoring blended with a
cosine-similarity check against hardcoded prototype text, using either a from-scratch
hashing vectorizer (default) or Google's hosted `text-embedding-004` API if
`GEMINI_API_KEY` is set. It is not a custom-trained transformer model.

### Load testing

```bash
cd backend
gunicorn -w 4 -b 127.0.0.1:5055 app:app &
locust -f loadtest/locustfile.py --host=http://127.0.0.1:5055 --headless -u 20 -r 5 -t 30s
```

Measured locally (4 gunicorn workers, 20 concurrent users, 30s): **33.6 req/s aggregate**,
0% failures, median latency 250ms (health check: 130ms, login: 470ms — password hashing is
the bottleneck). This is a local benchmark, not a production load test.

## Notes

- Backend and frontend are already configured to work together locally.
- Do not commit `.env`, `node_modules`, `dist`, or `.venv`.
- If you prefer MongoDB Atlas, replace `MONGO_URI` in `backend/.env`.
