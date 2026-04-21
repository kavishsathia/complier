import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "complier — contract enforcement for AI agents",
  description:
    "A compiled DSL that enforces workflow contracts on tool-using AI agents at runtime. Define what your agent can do, and block everything else.",
  icons: {
    icon: "/tab.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
