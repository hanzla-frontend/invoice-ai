"""Invoice AI backend: FastAPI + LangChain + Groq."""
import asyncio
import io
import os
import zipfile
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from langchain_core.prompts import ChatPromptTemplate
from langchain_groq import ChatGroq
from pydantic import BaseModel, Field
from pypdf import PdfReader, PdfWriter

load_dotenv()

app = FastAPI(title="Invoice AI", version="1.0.0")

origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],  # lets the browser's OPTIONS preflight through
    allow_headers=["*"],
)

MAX_FILE_MB = 15
MAX_TEXT_CHARS = 12000


# ---------- Schemas ----------
class LineItem(BaseModel):
    description: str = Field(default="", description="Item or service description")
    quantity: Optional[float] = Field(default=None, description="Quantity")
    unit_price: Optional[float] = Field(default=None, description="Price per unit")
    amount: Optional[float] = Field(default=None, description="Line total")


class InvoiceData(BaseModel):
    invoice_number: Optional[str] = Field(default=None, description="Invoice number or ID")
    invoice_date: Optional[str] = Field(default=None, description="Invoice date as written")
    due_date: Optional[str] = Field(default=None, description="Due date as written")
    vendor_name: Optional[str] = Field(default=None, description="Company issuing the invoice")
    vendor_email: Optional[str] = Field(default=None, description="Vendor email")
    client_name: Optional[str] = Field(default=None, description="Customer being billed")
    client_email: Optional[str] = Field(default=None, description="Customer email")
    currency: Optional[str] = Field(default=None, description="Currency code or symbol")
    subtotal: Optional[float] = Field(default=None, description="Subtotal before tax")
    tax: Optional[float] = Field(default=None, description="Tax amount")
    total: Optional[float] = Field(default=None, description="Total amount due")
    line_items: List[LineItem] = Field(default_factory=list, description="All line items")


# ---------- Helpers ----------
def get_chain():
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY is missing. Add it to backend/.env")
    llm = ChatGroq(
        model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
        temperature=0,
        api_key=api_key,
    )
    prompt = ChatPromptTemplate.from_messages(
        [
            (
                "system",
                "You extract structured data from invoice text. Only use information present in the text. "
                "If a field is missing, leave it null. Return numbers without currency symbols or commas.",
            ),
            ("human", "Invoice text:\n\n{text}"),
        ]
    )
    return prompt | llm.with_structured_output(InvoiceData)


async def read_pdf_upload(file: UploadFile) -> bytes:
    data = await file.read()
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail=f"{file.filename} is not a PDF")
    if len(data) > MAX_FILE_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"{file.filename} is larger than {MAX_FILE_MB} MB")
    return data


def pdf_text(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    text = "\n".join((page.extract_text() or "") for page in reader.pages)
    return text.strip()[:MAX_TEXT_CHARS]


# ---------- Routes ----------
@app.get("/")
def root():
    return {"status": "ok", "docs": "/docs"}


@app.get("/health")
def health():
    return {"status": "ok", "groq_key_set": bool(os.getenv("GROQ_API_KEY"))}


@app.post("/api/extract")
async def extract(files: List[UploadFile] = File(...)):
    """Read invoice PDFs and return structured data for each one."""
    chain = get_chain()

    async def process(file: UploadFile):
        try:
            data = await read_pdf_upload(file)
            text = pdf_text(data)
            if not text:
                return {"filename": file.filename, "error": "No readable text. This looks like a scanned PDF."}
            result = await chain.ainvoke({"text": text})
            return {"filename": file.filename, "data": result.model_dump()}
        except HTTPException as e:
            return {"filename": file.filename, "error": e.detail}
        except Exception as e:  # noqa: BLE001
            return {"filename": file.filename, "error": f"Extraction failed: {e}"}

    # read uploads first (UploadFile streams close after the request body is consumed)
    results = []
    for f in files:
        results.append(await process(f))
    return {"results": results}


@app.post("/api/split")
async def split(file: UploadFile = File(...)):
    """Split one PDF into one PDF per page and return them as a ZIP."""
    data = await read_pdf_upload(file)
    reader = PdfReader(io.BytesIO(data))
    base = os.path.splitext(file.filename or "document")[0]

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for i, page in enumerate(reader.pages, start=1):
            writer = PdfWriter()
            writer.add_page(page)
            out = io.BytesIO()
            writer.write(out)
            zf.writestr(f"{base}_page_{i:03d}.pdf", out.getvalue())
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{base}_split.zip"'},
    )
