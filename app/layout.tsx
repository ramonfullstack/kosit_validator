import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kosit Validator",
  description:
    "Valide e extraia arquivos XML (ZUGFeRD / Factur-X / XRechnung) embutidos em PDFs."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
