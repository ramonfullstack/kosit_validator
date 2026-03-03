"use client";

import { useState } from "react";

/* ── Validation types ── */

type XmlFileResult = {
  objectId: string;
  filename: string | null;
  size: number;
  compressed: boolean;
  wellFormed: boolean | null;
  parseError: string | null;
  matchReason: string;
};

type ValidationResponse = {
  isPdf: boolean;
  hasEmbeddedFiles: boolean;
  hasEmbeddedXml: boolean;
  isValid: boolean;
  files: XmlFileResult[];
  warnings: string[];
  debug: string[];
};

/* ── Extraction types ── */

type ExtractedXml = {
  objectId: string;
  filename: string | null;
  size: number;
  content: string;
  matchReason: string;
};

type ExtractionResponse = {
  isPdf: boolean;
  files: ExtractedXml[];
  error: string | null;
  debug: string[];
};

type ValidatorState = "idle" | "processing" | "done" | "error";
type ActiveTab = "validate" | "extract";

/* ── Helpers ── */

function downloadXml(content: string, filename: string) {
  const blob = new Blob([content], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function PdfXmlValidator() {
  const [file, setFile] = useState<File | null>(null);
  const [tab, setTab] = useState<ActiveTab>("validate");

  /* Validation state */
  const [valState, setValState] = useState<ValidatorState>("idle");
  const [valError, setValError] = useState("");
  const [valResult, setValResult] = useState<ValidationResponse | null>(null);

  /* Extraction state */
  const [extState, setExtState] = useState<ValidatorState>("idle");
  const [extError, setExtError] = useState("");
  const [extResult, setExtResult] = useState<ExtractionResponse | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  /* Debug toggle */
  const [showDebug, setShowDebug] = useState(false);

  /* ── Validate ── */

  async function validatePdf() {
    if (!file) return;
    setValState("processing");
    setValError("");
    setValResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/validate-pdf-xml", {
        method: "POST",
        body: formData,
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Falha na validacao do PDF.");
      }

      setValResult(payload as ValidationResponse);
      setValState("done");
    } catch (cause) {
      setValState("error");
      setValError(
        cause instanceof Error ? cause.message : "Falha na validacao do PDF."
      );
    }
  }

  /* ── Extract ── */

  async function extractXml() {
    if (!file) return;
    setExtState("processing");
    setExtError("");
    setExtResult(null);
    setPreviewIndex(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/extract-pdf-xml", {
        method: "POST",
        body: formData,
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Falha ao extrair XML do PDF.");
      }

      const data = payload as ExtractionResponse;
      setExtResult(data);
      setExtState("done");
      if (data.files.length > 0) setPreviewIndex(0);
    } catch (cause) {
      setExtState("error");
      setExtError(
        cause instanceof Error ? cause.message : "Falha ao extrair XML do PDF."
      );
    }
  }

  return (
    <section className="card grid">
      <h2>PDF &rarr; XML</h2>
      <p className="muted">
        Valide ou extraia arquivos XML embutidos dentro de um PDF.
      </p>

      {/* File input */}
      <div>
        <label className="label" htmlFor="pdf-xml-file">
          Arquivo PDF
        </label>
        <input
          id="pdf-xml-file"
          className="input"
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setValResult(null);
            setExtResult(null);
            setValState("idle");
            setExtState("idle");
          }}
        />
      </div>

      {/* Tab toggle */}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button
          className={`button ${tab === "validate" ? "" : "secondary"}`}
          style={{ flex: 1 }}
          onClick={() => setTab("validate")}
        >
          Validar
        </button>
        <button
          className={`button ${tab === "extract" ? "" : "secondary"}`}
          style={{ flex: 1 }}
          onClick={() => setTab("extract")}
        >
          Extrair XML
        </button>
      </div>

      {/* ── VALIDATE TAB ── */}
      {tab === "validate" && (
        <>
          <button
            className="button"
            onClick={validatePdf}
            disabled={!file || valState === "processing"}
          >
            {valState === "processing" ? "Validando..." : "Validar PDF"}
          </button>

          {valState === "error" && <p className="muted">Erro: {valError}</p>}

          {valResult ? (
            <div className="result-box">
              <p>
                <strong>Status:</strong>{" "}
                {valResult.hasEmbeddedXml
                  ? valResult.isValid
                    ? "✅ XML embutido encontrado e valido"
                    : "⚠️ XML embutido encontrado com erros de estrutura"
                  : "❌ Nenhum XML embutido encontrado"}
              </p>
              <p>
                <strong>Embedded files detectados:</strong>{" "}
                {valResult.hasEmbeddedFiles ? "Sim" : "Nao"}
              </p>
              <p>
                <strong>Arquivos XML detectados:</strong>{" "}
                {valResult.files.length}
              </p>
              {valResult.files.length > 0 && (
                <ul>
                  {valResult.files.map((xmlFile) => (
                    <li key={xmlFile.objectId}>
                      {xmlFile.filename ?? "Sem nome"} ({xmlFile.objectId}) –{" "}
                      {xmlFile.size} bytes –{" "}
                      {xmlFile.wellFormed === null
                        ? "Nao foi possivel validar estrutura"
                        : xmlFile.wellFormed
                        ? "Estrutura XML OK"
                        : `Estrutura invalida: ${xmlFile.parseError}`}
                      <br />
                      <span className="muted" style={{ fontSize: "0.75rem" }}>
                        match: {xmlFile.matchReason}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {valResult.warnings.length > 0 && (
                <>
                  <p>
                    <strong>Avisos:</strong>
                  </p>
                  <ul>
                    {valResult.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </>
              )}
              {valResult.debug.length > 0 && (
                <details style={{ marginTop: "0.5rem" }}>
                  <summary className="muted" style={{ cursor: "pointer", fontSize: "0.8rem" }}>
                    Debug info ({valResult.debug.length} entries)
                  </summary>
                  <pre
                    style={{
                      fontSize: "0.7rem",
                      background: "#f1f5f0",
                      padding: "0.5rem",
                      borderRadius: "6px",
                      maxHeight: "200px",
                      overflow: "auto",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {valResult.debug.join("\n")}
                  </pre>
                </details>
              )}
            </div>
          ) : (
            <div className="result-box">
              Resultado da validacao aparecera aqui.
            </div>
          )}
        </>
      )}

      {/* ── EXTRACT TAB ── */}
      {tab === "extract" && (
        <>
          <button
            className="button"
            onClick={extractXml}
            disabled={!file || extState === "processing"}
          >
            {extState === "processing" ? "Extraindo..." : "Extrair XML"}
          </button>

          {extState === "error" && <p className="muted">Erro: {extError}</p>}

          {extResult ? (
            <div className="result-box" style={{ gap: "0.75rem", display: "grid" }}>
              {extResult.files.length === 0 ? (
                <p>Nenhum XML embutido encontrado no PDF.</p>
              ) : (
                <>
                  <p>
                    <strong>{extResult.files.length}</strong> arquivo(s) XML
                    extraido(s):
                  </p>

                  {/* File list */}
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "0.5rem",
                    }}
                  >
                    {extResult.files.map((xmlFile, index) => (
                      <button
                        key={xmlFile.objectId}
                        className={`button ${
                          previewIndex === index ? "" : "secondary"
                        }`}
                        style={{ fontSize: "0.8rem", padding: "0.4rem 0.75rem", flex: "none", width: "auto" }}
                        onClick={() => setPreviewIndex(index)}
                      >
                        {xmlFile.filename ?? `xml-${index + 1}.xml`}
                        <span style={{ marginLeft: "0.4rem", opacity: 0.7 }}>
                          ({xmlFile.size} bytes – {xmlFile.matchReason})
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* XML preview */}
                  {previewIndex !== null && extResult.files[previewIndex] && (
                    <div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: "0.5rem",
                        }}
                      >
                        <span className="label" style={{ margin: 0 }}>
                          Preview:{" "}
                          {extResult.files[previewIndex].filename ??
                            `xml-${previewIndex + 1}.xml`}
                        </span>
                        <button
                          className="button secondary"
                          style={{
                            fontSize: "0.8rem",
                            padding: "0.3rem 0.75rem",
                            width: "auto",
                          }}
                          onClick={() => {
                            const f = extResult.files[previewIndex];
                            downloadXml(
                              f.content,
                              f.filename ?? `xml-${previewIndex + 1}.xml`
                            );
                          }}
                        >
                          ⬇ Download
                        </button>
                      </div>
                      <pre
                        style={{
                          background: "#f1f5f0",
                          border: "1px solid var(--border)",
                          borderRadius: "8px",
                          padding: "0.75rem",
                          fontSize: "0.8rem",
                          maxHeight: "400px",
                          overflow: "auto",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-all",
                        }}
                      >
                        <code>{extResult.files[previewIndex].content}</code>
                      </pre>
                    </div>
                  )}

                  {/* Download all */}
                  {extResult.files.length > 1 && (
                    <button
                      className="button secondary"
                      onClick={() => {
                        for (const [i, f] of extResult.files.entries()) {
                          downloadXml(
                            f.content,
                            f.filename ?? `xml-${i + 1}.xml`
                          );
                        }
                      }}
                    >
                      ⬇ Baixar todos os XMLs
                    </button>
                  )}
                </>
              )}

              {/* Debug info for extraction */}
              {extResult.debug.length > 0 && (
                <details style={{ marginTop: "0.5rem" }}>
                  <summary className="muted" style={{ cursor: "pointer", fontSize: "0.8rem" }}>
                    Debug info ({extResult.debug.length} entries)
                  </summary>
                  <pre
                    style={{
                      fontSize: "0.7rem",
                      background: "#f1f5f0",
                      padding: "0.5rem",
                      borderRadius: "6px",
                      maxHeight: "200px",
                      overflow: "auto",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {extResult.debug.join("\n")}
                  </pre>
                </details>
              )}
            </div>
          ) : (
            <div className="result-box">
              O XML extraido aparecera aqui.
            </div>
          )}
        </>
      )}
    </section>
  );
}
