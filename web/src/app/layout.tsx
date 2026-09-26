import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque } from "next/font/google";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { Providers } from "@/components/Providers";
import { NetworkBoundary } from "@/lib/network-context";
import "./globals.css";

const bricolage = Bricolage_Grotesque({ variable: "--font-bricolage", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ArcGift",
  description: "Wrap USDC as a gift, share a link, and let them open it.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f1fa" },
    { media: "(prefers-color-scheme: dark)", color: "#14132b" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${bricolage.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <Providers>
          <Header />
          <main className="mx-auto flex w-full max-w-[440px] flex-1 flex-col px-4 pt-4 pb-12">
            <NetworkBoundary>{children}</NetworkBoundary>
          </main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
