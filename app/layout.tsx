import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
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
  metadataBase: new URL("https://knitstep.vercel.app"),
  title: "织步 KnitStep - 智能编织步骤清单",
  description: "一键转换中英文图解，智能识别编织步骤，时刻追踪编织进度",
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
  openGraph: {
    title: "织步 KnitStep - 智能编织步骤清单",
    description: "一键转换中英文图解，智能识别编织步骤，时刻追踪编织进度",
    images: [{ url: "/icon.svg", width: 512, height: 512 }],
  },
  twitter: {
    card: "summary",
    title: "织步 KnitStep - 智能编织步骤清单",
    description: "一键转换中英文图解，智能识别编织步骤，时刻追踪编织进度",
    images: ["/icon.svg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh" suppressHydrationWarning>
      <head>
        {/* Prevent iOS Safari from auto-detecting phone numbers / dates in text,
            which inserts <a> elements into the DOM that React never rendered,
            causing tree hydration errors on mobile. */}
        <meta name="format-detection" content="telephone=no, date=no, address=no, email=no" />
      </head>
      <body className={`${quicksand.variable} ${mPlusRounded.variable} antialiased`} suppressHydrationWarning>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
