import { PdfXmlValidator } from "./components/pdf-xml-validator";

export default function HomePage() {
  return (
    <main className="grid" style={{ gap: "1.2rem" }}>
      <section className="card grid" style={{ gap: "0.4rem" }}>
        <p className="muted" style={{ letterSpacing: "0.08em", textTransform: "uppercase", fontSize: "0.75rem" }}>
          Kosit Validator
        </p>
        <h1 style={{ fontSize: "2rem" }}>Validador de PDF com XML embutido</h1>
        <p className="muted">
          Valide e extraia arquivos XML (ZUGFeRD / Factur-X / XRechnung) embutidos em PDFs.
        </p>
      </section>

      <PdfXmlValidator />
    </main>
  );
}
