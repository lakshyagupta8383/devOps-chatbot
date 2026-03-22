import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OnCall Mentor",
  description:
    "Incident-response chatbot simulator with hidden scenarios, runbook-grounded guidance, and solution evaluation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
