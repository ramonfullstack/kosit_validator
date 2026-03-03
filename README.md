# Kosit Validator

Validador e extrator de XML embutido em PDFs (ZUGFeRD / Factur-X / XRechnung).

## Funcionalidades

- **Validar** — verifica se o PDF contém XML embutido e valida a estrutura (well-formedness)
- **Extrair** — extrai o conteúdo XML do PDF com preview e download

## Stack

- Next.js 15 (App Router)
- Node.js `zlib` para descompressão de streams PDF
- Zero dependências externas além do React/Next

## Setup local

```bash
npm install
npm run dev
```

Acesse `http://localhost:3000`.

## Como funciona

1. O PDF é enviado via `FormData` para a API route
2. O parser lê todos os objetos do PDF em busca de streams com XML
3. Estratégias de detecção:
   - `/Type /Filespec` + `/EF` references
   - `/Type /EmbeddedFile` + `/Subtype` XML
   - `/AFRelationship` (ZUGFeRD/Factur-X/PDF/A-3)
   - Brute-force scan de todos os streams
4. Streams comprimidos com FlateDecode são descompactados automaticamente

## API

### `POST /api/validate-pdf-xml`

Valida XML embutido. Envie o PDF como `file` em `multipart/form-data`.

### `POST /api/extract-pdf-xml`

Extrai o conteúdo XML. Mesmo formato de envio.
