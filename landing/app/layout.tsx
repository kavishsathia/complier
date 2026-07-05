import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Complier: A Language for Encoding and Enforcing Agentic Workflows",
  description:
    "A single representation that unifies expressing and enforcing agentic workflows: contracts compile to a runtime graph enforced at the tool boundary.",
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
