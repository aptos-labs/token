import { useEffect, useState } from 'react';
import cx from 'classnames';
import styles from './navbar.module.css';
import { WalletSelector } from '@aptos-labs/wallet-adapter-ant-design';
import { Avatar, Typography } from 'antd';
import './wallet-adapter.css';

const { Text } = Typography;

export function Navbar({ pic, title }: { pic: string; title: string }) {
  const [sticky, setSticky] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      if (!sticky && window.scrollY > 70) {
        setSticky(true);
      } else if (sticky && window.scrollY === 0) {
        setSticky(false);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [sticky]);

  return (
    <nav className={cx(styles.menuBarFlat, { sticky })}>
      <div className={cx(styles.logo)}>
        <Avatar src={pic} />
      </div>
      <Text className={styles.logoTitle} ellipsis={true}>
        {title}
      </Text>
      <div style={{ paddingLeft: 10, paddingRight: 10 }}>
        <WalletSelector />
      </div>
    </nav>
  );
}
