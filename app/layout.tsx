import type { Metadata } from "next";
import { Geist, Geist_Mono, Bricolage_Grotesque } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const bricolageGrotesque = Bricolage_Grotesque({
  variable: "--font-bricolage-grotesque",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Audio Compressor",
  description: "App de compression de taille fichiers audio",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html suppressHydrationWarning lang="fr">
      <body
        className={`${geistSans.variable} ${bricolageGrotesque.variable} ${geistMono.variable} antialiased bg-gray-100`}
      >
        <div className="mx-auto flex min-h-screen max-w-[900px] flex-col bg-white font-sans text-sm">
          {children}
        </div>
      </body>
    </html>
  );
}
