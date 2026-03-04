import type { Metadata } from "next";
import { Quicksand, M_PLUS_Rounded_1c } from "next/font/google";
import "./globals.css";

const quicksand = Quicksand({
  variable: "--font-quicksand",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const mPlusRounded = M_PLUS_Rounded_1c({
  variable: "--font-zcool",
  weight: "700",
  preload: false,
});

export const metadata: Metadata = {
  title: "KnitStep 织步 - 智能编织助手",
  description: "将你的编织图解转为可勾选的步骤清单 · Turn knitting patterns into interactive checklists",
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
  openGraph: {
    title: "KnitStep 织步 - 智能编织助手",
    description: "将你的编织图解转为可勾选的步骤清单 · Turn knitting patterns into interactive checklists",
    images: [{ url: "/logo.png", width: 512, height: 512 }],
  },
  twitter: {
    card: "summary",
    title: "KnitStep 织步 - 智能编织助手",
    description: "将你的编织图解转为可勾选的步骤清单 · Turn knitting patterns into interactive checklists",
    images: ["/logo.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh">
      <body className={`${quicksand.variable} ${mPlusRounded.variable} antialiased`}>{children}</body>
    </html>
  );
}
