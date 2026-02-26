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
  title: "KnitStep · 编织图解助手",
  description: "粘贴编织图解，一键生成可勾选的步骤清单",
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
