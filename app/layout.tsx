import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "AI Frontdesk | Voice Booking Concierge",
  description:
    "A voice AI front desk for ski rental shops that captures booking details and prepares confirmations.",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
