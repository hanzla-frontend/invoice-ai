"use client";

import { useRef, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const fmt = (n, cur) =>
  n === null || n === undefined
    ? "–"
    : `${cur && cur.length <= 3 ? cur + " " : ""}${Number(n).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [files, setFiles] = useState([]);
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef(null);

  function addFiles(list) {
    const pdfs = Array.from(list).filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    setFiles((prev) => [...prev, ...pdfs]);
    setError(pdfs.length < list.length ? "Only PDF files were added." : "");
  }

  async function extract() {
    if (!files.length) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      files.forEach((f) => form.append("files", f));
      const res = await fetch(`${API}/api/extract`, { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Server returned ${res.status}`);
      }
      const json = await res.json();
      setResults(json.results);
    } catch (e) {
      setError(`${e.message}. Check that the backend is running at ${API}.`);
    } finally {
      setBusy(false);
    }
  }

  async function split(file) {
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API}/api/split`, { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Server returned ${res.status}`);
      }
      download(await res.blob(), file.name.replace(/\.pdf$/i, "") + "_split.zip");
    } catch (e) {
      setError(`Split failed: ${e.message}`);
    }
  }

  function exportCsv() {
    const head = ["File", "Invoice no", "Date", "Due", "Vendor", "Client", "Currency", "Subtotal", "Tax", "Total"];
    const rows = results
      .filter((r) => r.data)
      .map((r) => {
        const d = r.data;
        return [r.filename, d.invoice_number, d.invoice_date, d.due_date, d.vendor_name, d.client_name, d.currency, d.subtotal, d.tax, d.total];
      });
    const csv = [head, ...rows]
      .map((row) => row.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    download(new Blob([csv], { type: "text/csv" }), "invoices.csv");
  }

  const total = results.reduce((s, r) => s + (r.data?.total || 0), 0);

  return (
    <main className="page">
      <header className="top">
        <h1>Invoice AI</h1>
        <p>Drop in invoice PDFs. Get the numbers out as a table, or split a PDF into single pages.</p>
      </header>

      <section className="layout">
        <aside className="panel">
          <div
            className="drop"
            onClick={() => input.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              addFiles(e.dataTransfer.files);
            }}
          >
            <strong>Add PDF invoices</strong>
            <span>Drag files here or click to browse</span>
            <input
              ref={input}
              type="file"
              accept="application/pdf"
              multiple
              hidden
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {files.length > 0 && (
            <ul className="files">
              {files.map((f, i) => (
                <li key={f.name + i}>
                  <span className="name">{f.name}</span>
                  <span className="actions">
                    <button className="link" onClick={() => split(f)}>Split pages</button>
                    <button className="link" onClick={() => setFiles(files.filter((_, j) => j !== i))}>Remove</button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <button className="primary" disabled={!files.length || busy} onClick={extract}>
            {busy ? "Reading invoices…" : `Extract data from ${files.length || ""} ${files.length === 1 ? "file" : "files"}`}
          </button>
          {error && <p className="error" role="alert">{error}</p>}
        </aside>

        <section className="ledger" aria-live="polite">
          {results.length === 0 ? (
            <div className="empty">
              <h2>No invoices read yet</h2>
              <p>Add one or more PDFs, then choose Extract data. Results appear here.</p>
            </div>
          ) : (
            <>
              <div className="ledger-head">
                <h2>{results.length} {results.length === 1 ? "invoice" : "invoices"}</h2>
                <button className="secondary" onClick={exportCsv}>Download CSV</button>
              </div>
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Invoice</th><th>Date</th><th>Vendor</th><th>Client</th>
                      <th className="num">Subtotal</th><th className="num">Tax</th><th className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r, i) =>
                      r.error ? (
                        <tr key={i} className="bad">
                          <td>{r.filename}</td>
                          <td colSpan={6}>{r.error}</td>
                        </tr>
                      ) : (
                        <tr key={i}>
                          <td>{r.data.invoice_number || r.filename}</td>
                          <td>{r.data.invoice_date || "–"}</td>
                          <td>{r.data.vendor_name || "–"}</td>
                          <td>{r.data.client_name || "–"}</td>
                          <td className="num">{fmt(r.data.subtotal, r.data.currency)}</td>
                          <td className="num">{fmt(r.data.tax, r.data.currency)}</td>
                          <td className="num strong">{fmt(r.data.total, r.data.currency)}</td>
                        </tr>
                      )
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={6}>Sum of totals</td>
                      <td className="num strong">{total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </section>
      </section>
    </main>
  );
}
