import { inflateRawSync, inflateSync } from "node:zlib";

type PdfObject = {
  id: string;
  body: string;
  dictionary: string;
  stream: Buffer | null;
};

export type ExtractedXml = {
  objectId: string;
  filename: string | null;
  size: number;
  content: string;
  matchReason: string;
};

export type PdfXmlExtractionResult = {
  isPdf: boolean;
  files: ExtractedXml[];
  error: string | null;
  debug: string[];
};

/* ────────────────── PDF name / hex decoding ────────────────── */

function normalizePdfName(value: string) {
  return value
    .replace(/#([0-9a-fA-F]{2})/g, (_m, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .toLowerCase();
}

function decodeHexString(hex: string): string {
  const clean = hex.replace(/\s+/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < clean.length - 1; i += 2) {
    bytes.push(parseInt(clean.slice(i, i + 2), 16));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let result = "";
    for (let i = 2; i < bytes.length - 1; i += 2) {
      result += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    }
    return result;
  }
  return Buffer.from(bytes).toString("latin1");
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

function decodeStream(stream: Buffer, filters: string[]) {
  if (!filters.length) {
    return { data: stream, warning: null as string | null };
  }
  if (
    filters.length === 1 &&
    (filters[0] === "flatedecode" || filters[0] === "fl")
  ) {
    try {
      return { data: inflateSync(stream), warning: null as string | null };
    } catch {
      try {
        return { data: inflateRawSync(stream), warning: null as string | null };
      } catch {
        return {
          data: stream,
          warning: "Falha ao descompactar stream FlateDecode.",
        };
      }
    }
  }
  return {
    data: stream,
    warning: `Filtro de stream nao suportado: ${filters.join(", ")}`,
  };
}

/* ────────────────── XML detection ────────────────── */

function looksLikeXml(text: string) {
  const trimmed = text.replace(/^\uFEFF/, "").trimStart();
  return (
    trimmed.startsWith("<?xml") ||
    /^<([A-Za-z_][\w:.-]*)(\s|>|\/)/.test(trimmed)
  );
}

function tryExtractXml(data: Buffer): string | null {
  for (const encoding of ["utf8", "latin1"] as const) {
    const candidate = data.toString(encoding);
    if (looksLikeXml(candidate)) return candidate;
    const xmlStart = candidate.indexOf("<?xml");
    if (xmlStart >= 0) return candidate.slice(xmlStart);
  }
  return null;
}

/* ────────────────── PDF object parsing ────────────────── */

function parsePdfObjects(buffer: Buffer) {
  const source = buffer.toString("latin1");
  const objects: PdfObject[] = [];
  const objectPattern = /(\d+)\s+(\d+)\s+obj([\s\S]*?)endobj/g;

  let match: RegExpExecArray | null;
  while ((match = objectPattern.exec(source)) !== null) {
    const objectId = `${match[1]} ${match[2]} R`;
    const body = match[3];
    const streamStart = body.indexOf("stream");
    const streamEnd = body.lastIndexOf("endstream");

    let stream: Buffer | null = null;
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
      stream = Buffer.from(body.slice(dataStart, dataEnd), "latin1");
    }

    objects.push({ id: objectId, body, dictionary, stream });
  }

  return objects;
}

/* ────────────────── Filename extraction ────────────────── */

function extractFilename(dict: string): string | null {
  const parenMatch =
    dict.match(/\/UF\s*\(([^)]*)\)/) ??
    dict.match(/\/F\s*\(([^)]*)\)/);
  if (parenMatch?.[1]) return parenMatch[1];

  const hexMatch =
    dict.match(/\/UF\s*<([0-9a-fA-F\s]+)>/) ??
    dict.match(/\/F\s*<([0-9a-fA-F\s]+)>/);
  if (hexMatch?.[1]) return decodeHexString(hexMatch[1]);

  return null;
}

/* ────────────────── Find XML references (broad) ────────────────── */

function findXmlReferences(objects: PdfObject[]) {
  const refs = new Map<string, string>();
  const debugInfo: string[] = [];

  for (const obj of objects) {
    const dict = obj.dictionary + obj.body;

    const isFilespec = /\/Type\s*\/Filespec\b/.test(dict);
    const hasEfDict = /\/EF\s*<</.test(dict);
    const hasAfRelationship = /\/AFRelationship\b/.test(dict);

    if (!isFilespec && !hasEfDict && !hasAfRelationship) continue;

    const filename = extractFilename(dict);
    debugInfo.push(
      `obj ${obj.id}: filespec=${isFilespec} ef=${hasEfDict} af=${hasAfRelationship} filename=${filename}`
    );

    const isXmlFile = filename ? /\.(xml|xmp)$/i.test(filename) : false;
    if (!isXmlFile && !hasAfRelationship) continue;

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

    if (hasAfRelationship || isXmlFile) {
      const bodyRefPattern = /(\d+)\s+(\d+)\s+R/g;
      let bodyRefMatch: RegExpExecArray | null;
      while ((bodyRefMatch = bodyRefPattern.exec(dict)) !== null) {
        const refId = `${bodyRefMatch[1]} ${bodyRefMatch[2]} R`;
        if (!refs.has(refId)) {
          refs.set(refId, filename ?? "embedded.xml");
        }
      }
    }
  }

  return { refs, debugInfo };
}

/* ────────────────── Main extraction function ────────────────── */

/**
 * Extract all embedded XML files from a PDF buffer, returning their text content.
 * Uses multiple strategies: Filespec references, EmbeddedFile types, and brute-force stream scanning.
 */
export function extractXmlFromPdf(input: Buffer): PdfXmlExtractionResult {
  const debug: string[] = [];
  const isPdf = input.toString("latin1", 0, 8).includes("%PDF-");
  if (!isPdf) {
    return {
      isPdf: false,
      files: [],
      error: "Arquivo enviado nao parece ser um PDF valido.",
      debug: [],
    };
  }

  const objects = parsePdfObjects(input);
  debug.push(`Total PDF objects: ${objects.length}`);
  debug.push(`Objects with streams: ${objects.filter((o) => o.stream).length}`);

  const { refs: xmlRefs, debugInfo } = findXmlReferences(objects);
  debug.push(...debugInfo);
  debug.push(`XML references found: ${xmlRefs.size}`);

  const files: ExtractedXml[] = [];
  const foundObjectIds = new Set<string>();

  // ── Pass 1: matched by Filespec / EF references ──
  for (const obj of objects) {
    if (!obj.stream) continue;

    const filterNames = parseFilters(obj.dictionary);
    const decoded = decodeStream(obj.stream, filterNames);

    const fileRef = xmlRefs.get(obj.id) ?? null;
    const hasEmbeddedType = /\/Type\s*\/EmbeddedFile\b/.test(obj.dictionary);
    const hasXmlSubtype =
      /\/Subtype\s*\/(?:application#2[fF]xml|text#2[fF]xml|xml)\b/i.test(
        obj.dictionary
      ) || /\/Subtype\s*\/text\/xml/i.test(obj.dictionary);

    const xmlText = tryExtractXml(decoded.data);
    const shouldInclude =
      Boolean(fileRef) ||
      (hasEmbeddedType && (hasXmlSubtype || xmlText)) ||
      (hasXmlSubtype && xmlText);

    if (!shouldInclude || !xmlText) continue;

    foundObjectIds.add(obj.id);
    const matchReason = [
      fileRef ? "filespec-ref" : null,
      hasEmbeddedType ? "embedded-type" : null,
      hasXmlSubtype ? "xml-subtype" : null,
    ]
      .filter(Boolean)
      .join(", ");

    files.push({
      objectId: obj.id,
      filename: fileRef,
      size: decoded.data.length,
      content: xmlText,
      matchReason,
    });
  }

  // ── Pass 2: brute-force scan of all remaining streams ──
  for (const obj of objects) {
    if (!obj.stream || foundObjectIds.has(obj.id)) continue;

    const filterNames = parseFilters(obj.dictionary);
    const decoded = decodeStream(obj.stream, filterNames);

    if (decoded.data.length < 50) continue;
    if (/\/Type\s*\/Page\b/.test(obj.dictionary)) continue;
    if (/\/Type\s*\/XObject\b/.test(obj.dictionary)) continue;
    if (/\/Type\s*\/Font\b/.test(obj.dictionary)) continue;
    if (/\/Subtype\s*\/Image\b/.test(obj.dictionary)) continue;
    if (/\/Subtype\s*\/Form\b/.test(obj.dictionary)) continue;

    const xmlText = tryExtractXml(decoded.data);
    if (!xmlText) continue;

    const trimmed = xmlText.replace(/^\uFEFF/, "").trimStart();
    const afterPi = trimmed.replace(/<\?[\s\S]*?\?>/g, "").trimStart();
    const hasRootElement = /<([A-Za-z_][\w:.-]*)[\s>\/]/.test(afterPi);
    if (!hasRootElement) continue;

    const isXmpMetadata =
      /^<\?xpacket\b/i.test(trimmed) || /<x:xmpmeta\b/i.test(trimmed);

    foundObjectIds.add(obj.id);

    files.push({
      objectId: obj.id,
      filename: isXmpMetadata ? "xmp-metadata.xml" : null,
      size: decoded.data.length,
      content: xmlText,
      matchReason: isXmpMetadata ? "brute-force-xmp" : "brute-force-scan",
    });
  }

  debug.push(`Total XML files extracted: ${files.length}`);

  return { isPdf: true, files, error: null, debug };
}
