import { NextResponse } from "next/server";
import { extractXmlFromPdf } from "@/lib/pdf/extract-xml";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Envie um arquivo PDF no campo 'file'." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = extractXmlFromPdf(buffer);

    if (!result.isPdf) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json(result);
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "Erro ao extrair XML do PDF.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
