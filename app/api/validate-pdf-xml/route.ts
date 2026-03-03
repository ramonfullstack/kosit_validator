import { NextResponse } from "next/server";
import { validatePdfEmbeddedXml } from "@/lib/pdf/embedded-xml-validator";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Envie um arquivo PDF no campo 'file'." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = validatePdfEmbeddedXml(buffer);

    return NextResponse.json(result);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Erro to validate PDF.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
