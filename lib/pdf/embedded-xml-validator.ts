type PdfObject = {
  id: string;
  body: string;
  dictionary: string;
  stream: Uint8Array | null;
};

type XmlFileResult = {
  objectId: string;
  filename: string | null;
  size: number;
  compressed: boolean;
  wellFormed: boolean | null;
  parseError: string | null;
  matchReason: string;
};

export type PdfXmlValidationResult = {
  isPdf: boolean;
  hasEmbeddedFiles: boolean;
  hasEmbeddedXml: boolean;
  isValid: boolean;
  files: XmlFileResult[];
  warnings: string[];
  debug: string[];
};

/* ────────────────── Byte / string helpers ────────────────── */

function uint8ToLatin1(data: Uint8Array): string {
  let result = "";
  for (let i = 0; i < data.length; i++) {
    result += String.fromCharCode(data[i]);
  }
  return result;
}

function latin1ToUint8(str: string): Uint8Array {
  const result = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    result[i] = str.charCodeAt(i) & 0xff;
  }
  return result;
}

/* ────────────────── Inflate (browser DecompressionStream) ────────────────── */

async function inflate(data: Uint8Array, format: CompressionFormat): Promise<Uint8Array> {
  const ds = new DecompressionStream(format);
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  // new Uint8Array(data) copies into a plain ArrayBuffer, required by WritableStreamDefaultWriter
  writer.write(new Uint8Array(data));
  writer.close();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/* ────────────────── PDF name decoding ────────────────── */

function normalizePdfName(value: string) {
  return value.replace(/#([0-9a-fA-F]{2})/g, (_match, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  ).toLowerCase();
}

/* ────────────────── Hex string decoding ────────────────── */

function decodeHexString(hex: string): string {
  const clean = hex.replace(/\s+/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < clean.length - 1; i += 2) {
    bytes.push(parseInt(clean.slice(i, i + 2), 16));
  }
  // Check for UTF-16 BOM (FEFF)
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let result = "";
    for (let i = 2; i < bytes.length - 1; i += 2) {
      result += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    }
    return result;
  }
  return uint8ToLatin1(new Uint8Array(bytes));
}

/* ────────────────── Stream filters ────────────────── */

function parseFilters(dictionary: string) {
  const filters: string[] = [];
  const listMatch = dictionary.match(/\/Filter\s*\[([\s\S]*?)\]/);
  if (listMatch) {
    const names = listMatch[1].match(/\/([A-Za-z0-9#]+)/g) ?? [];
    for (const name of names) {
      filters.push(normalizePdfName(name.slice(1)));
    }
    return filters;
  }

  const singleMatch = dictionary.match(/\/Filter\s*\/([A-Za-z0-9#]+)/);
  if (singleMatch?.[1]) {
    filters.push(normalizePdfName(singleMatch[1]));
  }

  return filters;
}

async function decodeStream(stream: Uint8Array, filters: string[]) {
  if (!filters.length) {
    return { data: stream, compressed: false, warning: null as string | null };
  }

  if (filters.length === 1 && (filters[0] === "flatedecode" || filters[0] === "fl")) {
    try {
      return { data: await inflate(stream, "deflate"), compressed: true, warning: null as string | null };
    } catch {
      try {
        return { data: await inflate(stream, "deflate-raw"), compressed: true, warning: null as string | null };
      } catch {
        return {
          data: stream,
          compressed: true,
          warning: "Falha ao descompactar stream FlateDecode."
        };
      }
    }
  }

  return {
    data: stream,
    compressed: true,
    warning: `Filtro de stream nao suportado: ${filters.join(", ")}`
  };
}

/* ────────────────── XML detection ────────────────── */

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function looksLikeXml(text: string) {
  const trimmed = text.replace(/^\uFEFF/, "").trimStart();
  return trimmed.startsWith("<?xml") || /^<([A-Za-z_][\w:.-]*)(\s|>|\/)/.test(trimmed);
}

function tryExtractXml(data: Uint8Array): string | null {
  const encodings: Array<(d: Uint8Array) => string> = [
    (d) => {
      try {
        return utf8Decoder.decode(d);
      } catch {
        return "";
      }
    },
    uint8ToLatin1,
  ];
  for (const decode of encodings) {
    const candidate = decode(data);
    if (!candidate) continue;
    if (looksLikeXml(candidate)) return candidate;
    const xmlStart = candidate.indexOf("<?xml");
    if (xmlStart >= 0) return candidate.slice(xmlStart);
  }
  return null;
}

/* ────────────────── XML well-formedness check ────────────────── */

function validateXmlWellFormed(xml: string) {
  const content = xml.replace(/^\uFEFF/, "");
  const stack: string[] = [];
  let i = 0;

  while (i < content.length) {
    const open = content.indexOf("<", i);
    if (open < 0) break;

    if (content.startsWith("<!--", open)) {
      const end = content.indexOf("-->", open + 4);
      if (end < 0) return { ok: false, error: "Comentario XML sem fechamento." };
      i = end + 3;
      continue;
    }

    if (content.startsWith("<![CDATA[", open)) {
      const end = content.indexOf("]]>", open + 9);
      if (end < 0) return { ok: false, error: "CDATA sem fechamento." };
      i = end + 3;
      continue;
    }

    if (content.startsWith("<?", open)) {
      const end = content.indexOf("?>", open + 2);
      if (end < 0) return { ok: false, error: "Instrucao de processamento sem fechamento." };
      i = end + 2;
      continue;
    }

    if (content.startsWith("<!DOCTYPE", open)) {
      let cursor = open + 9;
      let bracketDepth = 0;
      let inQuote: '"' | "'" | null = null;
      while (cursor < content.length) {
        const ch = content[cursor];
        if (inQuote) {
          if (ch === inQuote) inQuote = null;
          cursor += 1;
          continue;
        }
        if (ch === '"' || ch === "'") {
          inQuote = ch;
        } else if (ch === "[") {
          bracketDepth += 1;
        } else if (ch === "]") {
          bracketDepth = Math.max(0, bracketDepth - 1);
        } else if (ch === ">" && bracketDepth === 0) {
          break;
        }
        cursor += 1;
      }
      if (cursor >= content.length) return { ok: false, error: "DOCTYPE sem fechamento." };
      i = cursor + 1;
      continue;
    }

    if (content.startsWith("</", open)) {
      const close = content.indexOf(">", open + 2);
      if (close < 0) return { ok: false, error: "Tag de fechamento sem '>'." };
      const name = content.slice(open + 2, close).trim();
      const expected = stack.pop();
      if (!expected || expected !== name) {
        return { ok: false, error: `Fechamento inesperado: </${name}>.` };
      }
      i = close + 1;
      continue;
    }

    const close = content.indexOf(">", open + 1);
    if (close < 0) return { ok: false, error: "Tag de abertura sem '>'." };
    const rawInner = content.slice(open + 1, close).trim();
    const selfClosing = rawInner.endsWith("/");
    const normalized = selfClosing ? rawInner.slice(0, -1).trim() : rawInner;
    const name = normalized.split(/\s+/)[0];
    if (!name || !/^[A-Za-z_][\w:.-]*$/.test(name)) {
      return { ok: false, error: "Nome de tag invalido." };
    }
    if (!selfClosing) stack.push(name);
    i = close + 1;
  }

  if (stack.length) {
    return { ok: false, error: `Tags sem fechamento: ${stack.join(", ")}.` };
  }

  return { ok: true, error: null as string | null };
}

/* ────────────────── PDF object parsing ────────────────── */

function parsePdfObjects(pdfData: Uint8Array) {
  const source = uint8ToLatin1(pdfData);
  const objects: PdfObject[] = [];
  const objectPattern = /(\d+)\s+(\d+)\s+obj([\s\S]*?)endobj/g;

  let match: RegExpExecArray | null;
  while ((match = objectPattern.exec(source)) !== null) {
    const objectId = `${match[1]} ${match[2]} R`;
    const body = match[3];
    const streamStart = body.indexOf("stream");
    const streamEnd = body.lastIndexOf("endstream");

    let stream: Uint8Array | null = null;
    let dictionary = body;

    if (streamStart >= 0 && streamEnd > streamStart) {
      dictionary = body.slice(0, streamStart);

      let dataStart = streamStart + "stream".length;
      if (body[dataStart] === "\r" && body[dataStart + 1] === "\n") {
        dataStart += 2;
      } else if (body[dataStart] === "\n" || body[dataStart] === "\r") {
        dataStart += 1;
      }

      const dataEnd =
        body[streamEnd - 1] === "\n" && body[streamEnd - 2] === "\r"
          ? streamEnd - 2
          : body[streamEnd - 1] === "\n"
          ? streamEnd - 1
          : streamEnd;
      stream = latin1ToUint8(body.slice(dataStart, dataEnd));
    }

    objects.push({ id: objectId, body, dictionary, stream });
  }

  return objects;
}

/* ────────────────── Filename extraction (multiple strategies) ────────────────── */

function extractFilename(dict: string): string | null {
  // Strategy 1: /UF (unicode filename) or /F (filename) with parentheses
  const parenMatch =
    dict.match(/\/UF\s*\(([^)]*)\)/) ??
    dict.match(/\/F\s*\(([^)]*)\)/);
  if (parenMatch?.[1]) return parenMatch[1];

  // Strategy 2: hex-encoded strings <FEFF...>
  const hexMatch =
    dict.match(/\/UF\s*<([0-9a-fA-F\s]+)>/) ??
    dict.match(/\/F\s*<([0-9a-fA-F\s]+)>/);
  if (hexMatch?.[1]) return decodeHexString(hexMatch[1]);

  // Strategy 3: /Desc or description field
  const descMatch = dict.match(/\/Desc\s*\(([^)]*)\)/);
  if (descMatch?.[1]) return descMatch[1];

  return null;
}

/* ────────────────── Find XML references (broad strategies) ────────────────── */

function findXmlReferences(objects: PdfObject[]) {
  const refs = new Map<string, string>();
  const hasEmbeddedFiles = objects.some(
    (obj) => /\/EmbeddedFiles\b/.test(obj.body) || /\/EmbeddedFile\b/.test(obj.body)
  );
  const debugInfo: string[] = [];

  for (const obj of objects) {
    const dict = obj.dictionary + obj.body;

    // Strategy 1: standard /Type /Filespec
    const isFilespec = /\/Type\s*\/Filespec\b/.test(dict);
    // Strategy 2: has /EF dictionary (embedded file reference)
    const hasEfDict = /\/EF\s*<</.test(dict);
    // Strategy 3: has /AFRelationship (PDF/A-3, ZUGFeRD, Factur-X)
    const hasAfRelationship = /\/AFRelationship\b/.test(dict);

    if (!isFilespec && !hasEfDict && !hasAfRelationship) continue;

    const filename = extractFilename(dict);
    debugInfo.push(`obj ${obj.id}: filespec=${isFilespec} ef=${hasEfDict} af=${hasAfRelationship} filename=${filename}`);

    const isXmlFile = filename
      ? /\.(xml|xmp)$/i.test(filename)
      : false;

    // Even without .xml extension, if it has AFRelationship, check for references
    if (!isXmlFile && !hasAfRelationship) continue;

    // Find all object references inside /EF dictionary
    const efBlock = dict.match(/\/EF\s*<<([\s\S]*?)>>/);
    if (efBlock) {
      const refPattern = /(\d+)\s+(\d+)\s+R/g;
      let refMatch: RegExpExecArray | null;
      while ((refMatch = refPattern.exec(efBlock[1])) !== null) {
        refs.set(
          `${refMatch[1]} ${refMatch[2]} R`,
          filename ?? "embedded.xml"
        );
      }
    }

    // Also look for direct stream references in the full body
    const bodyRefPattern = /(\d+)\s+(\d+)\s+R/g;
    let bodyRefMatch: RegExpExecArray | null;
    if (hasAfRelationship || isXmlFile) {
      while ((bodyRefMatch = bodyRefPattern.exec(dict)) !== null) {
        const refId = `${bodyRefMatch[1]} ${bodyRefMatch[2]} R`;
        if (!refs.has(refId)) {
          // Only add if the referenced object has a stream (checked later)
          refs.set(refId, filename ?? "embedded.xml");
        }
      }
    }
  }

  return { refs, hasEmbeddedFiles, debugInfo };
}

/* ────────────────── Main validation function ────────────────── */

export async function validatePdfEmbeddedXml(input: Uint8Array): Promise<PdfXmlValidationResult> {
  const warnings: string[] = [];
  const debug: string[] = [];
  const isPdf = uint8ToLatin1(input.slice(0, 8)).includes("%PDF-");
  if (!isPdf) {
    return {
      isPdf: false,
      hasEmbeddedFiles: false,
      hasEmbeddedXml: false,
      isValid: false,
      files: [],
      warnings: ["Arquivo enviado nao parece ser um PDF valido."],
      debug: []
    };
  }

  const objects = parsePdfObjects(input);
  debug.push(`Total PDF objects parsed: ${objects.length}`);
  debug.push(`Objects with streams: ${objects.filter((o) => o.stream).length}`);

  const { refs: xmlRefsByObject, hasEmbeddedFiles, debugInfo } = findXmlReferences(objects);
  debug.push(...debugInfo);
  debug.push(`XML references found: ${xmlRefsByObject.size}`);

  const files: XmlFileResult[] = [];
  const foundObjectIds = new Set<string>();

  // ── Pass 1: matched by Filespec/EF references ──
  for (const obj of objects) {
    if (!obj.stream) continue;

    const filterNames = parseFilters(obj.dictionary);
    const decoded = await decodeStream(obj.stream, filterNames);
    if (decoded.warning) warnings.push(`${obj.id}: ${decoded.warning}`);

    const fileRef = xmlRefsByObject.get(obj.id) ?? null;
    const hasEmbeddedType = /\/Type\s*\/EmbeddedFile\b/.test(obj.dictionary);
    const hasXmlSubtype =
      /\/Subtype\s*\/(?:application#2[fF]xml|text#2[fF]xml|xml)\b/i.test(obj.dictionary) ||
      /\/Subtype\s*\/text\/xml/i.test(obj.dictionary);

    const xmlText = tryExtractXml(decoded.data);

    const matchReason: string[] = [];
    if (fileRef) matchReason.push("filespec-ref");
    if (hasEmbeddedType) matchReason.push("embedded-type");
    if (hasXmlSubtype) matchReason.push("xml-subtype");

    const shouldInclude =
      Boolean(fileRef) ||
      (hasEmbeddedType && (hasXmlSubtype || xmlText)) ||
      (hasXmlSubtype && xmlText);

    if (!shouldInclude) continue;

    foundObjectIds.add(obj.id);

    let wellFormed: boolean | null = null;
    let parseError: string | null = null;
    if (xmlText) {
      const parsed = validateXmlWellFormed(xmlText);
      wellFormed = parsed.ok;
      parseError = parsed.error;
    }

    files.push({
      objectId: obj.id,
      filename: fileRef,
      size: decoded.data.length,
      compressed: decoded.compressed,
      wellFormed,
      parseError,
      matchReason: matchReason.join(", ")
    });
  }

  // ── Pass 2: brute-force scan — any stream containing XML ──
  for (const obj of objects) {
    if (!obj.stream || foundObjectIds.has(obj.id)) continue;

    const filterNames = parseFilters(obj.dictionary);
    const decoded = await decodeStream(obj.stream, filterNames);

    // Skip tiny streams (likely not XML documents) and page content streams
    if (decoded.data.length < 50) continue;
    if (/\/Type\s*\/Page\b/.test(obj.dictionary)) continue;
    if (/\/Type\s*\/XObject\b/.test(obj.dictionary)) continue;
    if (/\/Type\s*\/Font\b/.test(obj.dictionary)) continue;
    if (/\/Subtype\s*\/Image\b/.test(obj.dictionary)) continue;
    if (/\/Subtype\s*\/Form\b/.test(obj.dictionary)) continue;

    const xmlText = tryExtractXml(decoded.data);
    if (!xmlText) continue;

    // Additional check: must have a root element, not just a processing instruction
    const trimmed = xmlText.replace(/^\uFEFF/, "").trimStart();
    const hasRootElement = /<([A-Za-z_][\w:.-]*)[\s>\/]/.test(
      trimmed.replace(/<\?[\s\S]*?\?>/g, "").trimStart()
    );
    if (!hasRootElement) continue;

    // Skip XMP metadata (usually not the invoice XML)
    const isXmpMetadata = /^<\?xpacket\b/i.test(trimmed) || /<x:xmpmeta\b/i.test(trimmed);

    foundObjectIds.add(obj.id);

    let wellFormed: boolean | null = null;
    let parseError: string | null = null;
    const parsed = validateXmlWellFormed(xmlText);
    wellFormed = parsed.ok;
    parseError = parsed.error;

    files.push({
      objectId: obj.id,
      filename: isXmpMetadata ? "xmp-metadata.xml" : null,
      size: decoded.data.length,
      compressed: decoded.compressed,
      wellFormed,
      parseError,
      matchReason: isXmpMetadata ? "brute-force-xmp" : "brute-force-scan"
    });
  }

  const hasEmbeddedXml = files.length > 0 || xmlRefsByObject.size > 0;
  const isValid = hasEmbeddedXml && files.every((file) => file.wellFormed !== false);

  return {
    isPdf: true,
    hasEmbeddedFiles,
    hasEmbeddedXml,
    isValid,
    files,
    warnings,
    debug
  };
}
