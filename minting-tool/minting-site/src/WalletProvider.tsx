import {
  WalletProvider,
  AptosWalletAdapter,
} from '@manahippo/aptos-wallet-adapter';
import { useMemo } from 'react';

type WalletProviderProps = {
  children: any;
};

export default function WalletsProvider({ children }: WalletProviderProps) {
  const wallets = useMemo(() => [new AptosWalletAdapter()], []);

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
