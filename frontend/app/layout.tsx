import type { Metadata } from 'next';
import { WalletProvider } from '@/components/WalletProvider';
import { NavBar } from '@/components/NavBar';
import './globals.css';

export const metadata: Metadata = {
  title: 'RiverPay — Get Paid by the Second',
  description: 'Real-time money streaming for salaries, rent and subscriptions on Stellar.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <NavBar />
          <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}
