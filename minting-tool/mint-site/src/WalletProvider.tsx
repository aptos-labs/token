import {
  WalletProvider,
  AptosWalletAdapter,
  PontemWalletAdapter,
  FewchaWalletAdapter,
  RiseWalletAdapter,
  MartianWalletAdapter,
} from '@manahippo/aptos-wallet-adapter';
import { useMemo } from 'react';

type WalletProviderProps = {
  children: any;
};

export default function WalletsProvider({ children }: WalletProviderProps) {
  const wallets = useMemo(
    () => [
      new AptosWalletAdapter(),
      new PontemWalletAdapter(),
      new MartianWalletAdapter(),
      new FewchaWalletAdapter(),
      new RiseWalletAdapter(),
    ],
    []
  );

  return (
    <WalletProvider
      wallets={wallets}
      autoConnect={true}
      onError={(error: Error) => {
        console.error('Wallet Provider Error Message', error);
      }}
    >
      {children}
    </WalletProvider>
  );
}
