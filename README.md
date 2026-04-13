# Kosit Validator

Validador e extrator de XML embutido em PDFs (ZUGFeRD / Factur-X / XRechnung).

Funciona inteiramente no navegador — sem servidor, sem dependências externas.

## Funcionalidades

- **Validar** — verifica se o PDF contém XML embutido e valida a estrutura (well-formedness)
- **Extrair** — extrai o conteúdo XML do PDF com preview e download

## Stack

- Next.js 15 (App Router, static export)
- Browser `DecompressionStream` API para descompressão de streams PDF
- Zero dependências externas além do React/Next

## Rodar localmente

```bash
npm install
npm run dev
```

Acesse `http://localhost:3000/kosit_validator`.

## Build estático

```bash
npm run build
```

Gera o site estático na pasta `out/`.

## Deploy no GitHub Pages

O deploy é feito automaticamente via GitHub Actions ao fazer push na branch `main`.

O workflow `.github/workflows/deploy.yml`:
1. Executa `npm run build` (gera a pasta `out/`)
2. Publica o conteúdo de `out/` no GitHub Pages

O site fica disponível em `https://<usuario>.github.io/kosit_validator/`.

> **Ativar GitHub Pages**: no repositório, acesse *Settings → Pages → Source* e selecione **GitHub Actions**.
