import './globals.css';

export const metadata = {
  title: 'Tan-Bot · TAN-1',
  description: 'A warm, plain-English companion for people living with diabetes and the people who care for them.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
