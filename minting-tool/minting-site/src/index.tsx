import React from 'react';
import { ConfigProvider } from 'antd';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { AptosWalletAdapterProvider } from '@aptos-labs/wallet-adapter-react';

import { PetraWallet } from 'petra-plugin-wallet-adapter';
import { TrustWallet } from '@trustwallet/aptos-wallet-adapter';
import { PontemWallet } from '@pontem/wallet-adapter-plugin';
import { MartianWallet } from '@martianwallet/aptos-wallet-adapter';
import { RiseWallet } from '@rise-wallet/wallet-adapter';
import { SpikaWallet } from '@spika/aptos-plugin';
import { FewchaWallet } from 'fewcha-plugin-wallet-adapter';
import { MSafeWalletAdapter } from 'msafe-plugin-wallet-adapter';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <AptosWalletAdapterProvider
      plugins={[
        new PetraWallet(),
        new PontemWallet(),
        new MartianWallet(),
        new RiseWallet(),
        new FewchaWallet(),
        new SpikaWallet(),
        new TrustWallet(),
        new MSafeWalletAdapter(),
      ]}
      autoConnect={true}
    >
      <ConfigProvider
        theme={{
          token: {
            colorPrimary: '#1D4ED8',
            colorLink: '#1D4ED8',
          },
        }}
      >
        <App />
      </ConfigProvider>
    </AptosWalletAdapterProvider>
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
