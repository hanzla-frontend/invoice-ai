# Invoice AI

Next.js frontend + FastAPI backend. Upload invoice PDFs, extract invoice data with LangChain + Groq, and split PDFs into single pages.

## 1. Backend (Python)

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # Windows: copy .env.example .env
# open .env and paste your GROQ_API_KEY
uvicorn main:app --reload --port 8000
```

Check it works: open http://localhost:8000/health and http://localhost:8000/docs

## 2. Frontend (Next.js)

```bash
cd frontend
cp .env.local.example .env.local   # Windows: copy .env.local.example .env.local
npm install
npm run dev
```

Open http://localhost:3000

## Endpoints

| Method | Path | What it does |
|---|---|---|
| GET | /health | Status and whether the Groq key is set |
| POST | /api/extract | Multipart `files` (PDFs) -> JSON for each invoice |
| POST | /api/split | Multipart `file` (one PDF) -> ZIP of single-page PDFs |

## Fixing `{"detail":"Method Not Allowed"}`

This error means the URL exists but the HTTP method is wrong. Usual causes:

- You opened `/api/extract` or `/api/split` in the browser. Browsers send GET, and these routes only accept POST. Use the web page, or http://localhost:8000/docs to test.
- The frontend calls a different path than the backend defines (for example `/extract` instead of `/api/extract`).
- `NEXT_PUBLIC_API_URL` points at the Next.js port (3000) instead of the FastAPI port (8000). Restart `npm run dev` after editing `.env.local`.

## Notes

- Scanned (image only) PDFs have no text and will return an error. They need OCR first.
- Change the model with `GROQ_MODEL` in `backend/.env`.
