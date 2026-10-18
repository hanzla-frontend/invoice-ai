import "./globals.css";

export const metadata = {
  title: "Invoice AI",
  description: "Read invoice PDFs, pull out the numbers, split pages.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
