# Kosit Validator

Validador e extrator de XML embutido em PDFs (ZUGFeRD / Factur-X / XRechnung).

Funciona inteiramente no navegador — sem servidor dedicado, sem dependências externas.

## Funcionalidades

- **Validar** — verifica se o PDF contém XML embutido e valida a estrutura (well-formedness)
- **Extrair** — extrai o conteúdo XML do PDF com preview e download

## Stack

- Next.js 16 (App Router)
- Browser `DecompressionStream` API para descompressão de streams PDF
- Zero dependências externas além do React/Next

## Rodar localmente

```bash
npm install
npm run dev
```

Acesse `http://localhost:3000`.

## Build

```bash
npm run build
```

Gera build de produção do Next.js.
