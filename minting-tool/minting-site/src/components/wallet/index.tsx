import { useState } from 'react';
import { HexString } from 'aptos';
import { Button, Modal, Card, Typography, Dropdown, MenuProps } from 'antd';
import { useWallet } from '@manahippo/aptos-wallet-adapter';
import styles from './wallet.module.css';
import petra from '../../assets/petra.svg';

const iconMap = {
  Petra: petra,
};

type WalletName = keyof typeof iconMap;

function replaceRange(
  s: string,
  start: number,
  end: number,
  substitute: string
) {
  return s.substring(0, start) + substitute + s.substring(end);
}

export function WalletButton() {
  const [showWalletsPicker, setShowWalletsPicker] = useState(false);
  const { account, wallets, wallet, select, connected, disconnect } =
    useWallet();

  const items: MenuProps['items'] = [
    {
      label: `Disconnect ${wallet?.adapter.name}`,
      key: '1',
    },
  ];

  const menuProps = {
    items,
    onClick: (e: any) => {
      if (e.key === '1') {
        disconnect();
      }
    },
  };

  return (
    <>
      {!connected && (
        <>
          <Button
            type="primary"
            className={styles.mainButton}
            onClick={() => setShowWalletsPicker(true)}
            size="large"
          >
            Connect Wallet
          </Button>
          <Modal
            title="Connect Your Wallet"
            footer={null}
            open={showWalletsPicker}
            onCancel={() => setShowWalletsPicker(false)}
          >
            <div className={styles.pickerContainer}>
              {wallets
                .filter((w) => w.adapter.name === 'Petra')
                .map((w) => (
                  <Card key={w.adapter.name} className={styles.walletCard}>
                    <div className={styles.walletCardContainer}>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <img
                          style={{
                            width: '2em',
                            height: '2em',
                            marginRight: 10,
                          }}
                          src={iconMap[w.adapter.name as WalletName]}
                          alt={w.adapter.name}
                        />
                        <Typography.Text
                          style={{
                            color: 'black',
                            fontWeight: '500',
                            fontSize: '1.1em',
                          }}
                        >
                          {w.adapter.name}
                        </Typography.Text>
                      </div>
                      {w.readyState === 'Installed' ? (
                        <Button
                          type="primary"
                          onClick={() => {
                            console.log('>>>', w.adapter.name);
                            select(w.adapter.name);
                          }}
                        >
                          connect
                        </Button>
                      ) : (
                        <Button type="link" href={w.adapter.url}>
                          install
                        </Button>
                      )}
                    </div>
                  </Card>
                ))}
            </div>
          </Modal>
        </>
      )}
      {connected && (
        <Dropdown menu={menuProps} placement="bottom">
          <Button type="primary" className={styles.mainButton} size="large">
            {replaceRange(
              HexString.ensure(account?.address!).hex(),
              4,
              HexString.ensure(account?.address!).hex().length - 6,
              '...'
            )}
          </Button>
        </Dropdown>
      )}
    </>
  );
}
