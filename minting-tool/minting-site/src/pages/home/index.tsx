import { useEffect, useState } from 'react';
import {
  Button,
  InputNumber,
  Card,
  Form,
  Space,
  Typography,
  message,
} from 'antd';
import styles from './home.module.css';
import coverImg from '../../assets/aptos-zero.png';
import { WalletButton } from '../../components/wallet';
import { AptosClient } from 'aptos';
import moment from 'moment';
import { useWallet } from '@manahippo/aptos-wallet-adapter';

const MINTING_CONTRACT = process.env.REACT_APP_MINTING_CONTRACT;

const { useForm } = Form;
const { Text } = Typography;

function formatDate(dt: string | number): string {
  const mt = moment.unix(Number.parseInt(dt.toString(), 10));
  console.log(mt.toDate());
  return mt.format('LLLL');
}

function formatDateRange(start: string | number, end: string | number): string {
  const startMt = moment.unix(Number.parseInt(start.toString(), 10));
  const endMt = moment.unix(Number.parseInt(end.toString(), 10));
  if (new Date() < startMt.toDate()) {
    return `starts ${startMt.fromNow()}`;
  } else if (new Date() >= startMt.toDate() && new Date() <= endMt.toDate()) {
    return `ends ${endMt.fromNow()}`;
  } else {
    return 'already ended';
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function isStarted(start: string | number): boolean {
  const startMt = moment.unix(Number.parseInt(start.toString(), 10));
  return new Date() > startMt.toDate();
}

const client = new AptosClient(process.env.REACT_APP_NODE_URL!);

export function Home() {
  const [publicMintConf, setPublicMintConf] = useState<{
    start: string;
    end: string;
    price?: string;
  }>();
  const [wlMintConf, setWlMintConf] = useState<{
    start: string;
    end: string;
    price?: string;
  }>();

  const [refreshCounter, setRefreshCounter] = useState(1);

  const [wlTableHandle, setWlTableHandle] = useState('');

  const [loadingMintingTime, setLoadingMintingTime] = useState(false);
  const [minting, setMinting] = useState(false);

  const [collectionUrl, setCollectionUrl] = useState('');

  const [form] = useForm();
  const { account, signAndSubmitTransaction } = useWallet();

  useEffect(() => {
    form.setFieldValue('amount', 1);
  }, [form]);

  useEffect(() => {
    const handle = setInterval(() => {
      setRefreshCounter((prev) => prev + 1);
    }, 1000);

    return function cleanup() {
      if (handle) {
        clearInterval(handle);
      }
    };
  }, []);

  useEffect(() => {
    if (!wlTableHandle || !account?.address) return;
    (async () => {
      try {
        await client.getTableItem(wlTableHandle, {
          key_type: 'address',
          value_type: 'u64',
          key: account.address!,
        });
      } catch (e) {
        console.error(e);
      }
    })();
  }, [account, account?.address, wlTableHandle]);

  useEffect(() => {
    (async () => {
      try {
        setLoadingMintingTime(true);

        const [wlConfig, pubMintConfig, collectionConfig] = await Promise.all([
          client.getAccountResource(
            MINTING_CONTRACT!,
            `${MINTING_CONTRACT!}::minting::WhitelistMintConfig`
          ),
          client.getAccountResource(
            MINTING_CONTRACT!,
            `${MINTING_CONTRACT!}::minting::PublicMintConfig`
          ),
          client.getAccountResource(
            MINTING_CONTRACT!,
            `${MINTING_CONTRACT!}::minting::CollectionConfig`
          ),
        ]);

        const collectionData = collectionConfig.data as any;
        setCollectionUrl(collectionData.collection_uri);

        const wlConfigData = wlConfig.data as any;
        setWlMintConf({
          start: wlConfigData.whitelist_minting_start_time,
          end: wlConfigData.whitelist_minting_end_time,
          price: wlConfigData.whitelist_mint_price,
        });

        const pubMintConfigData = pubMintConfig.data as any;
        setPublicMintConf({
          start: pubMintConfigData.public_minting_start_time,
          end: pubMintConfigData.public_minting_end_time,
          price: pubMintConfigData.public_mint_price,
        });

        setWlTableHandle(
          (wlConfig.data as any)?.whitelisted_address?.buckets?.inner?.handle ||
            ''
        );
      } catch (e: any) {
        console.error(e);
        message.error(e?.message || 'Failed to load the minting information.');
      } finally {
        setLoadingMintingTime(false);
      }
    })();
  }, []);

  const onFinish = async (values: any) => {
    try {
      setMinting(true);
      const { hash } = await signAndSubmitTransaction({
        type: 'entry_function_payload',
        function: `${MINTING_CONTRACT}::minting::mint_nft`,
        type_arguments: [],
        arguments: [values.amount],
      });

      await client.waitForTransaction(hash, {
        timeoutSecs: 120,
        checkSuccess: true,
      });
      message.success(`Successfully minted ${values.amount} NFTs`);
    } catch (e: any) {
      console.error(e);
      message.error(e?.message || 'Failed to mint.');
    } finally {
      setMinting(false);
    }
  };

  return (
    <div className={styles.container}>
      <WalletButton />
      <div className={styles.innerContainer}>
        <img className={styles.coverImage} src={collectionUrl} alt="cover" />
        <Form
          onFinish={onFinish}
          form={form}
          className={styles.actionsContainer}
        >
          <Form.Item
            name="amount"
            rules={[
              {
                required: true,
                message: 'Please enter the amount of NFTs to mint!',
              },
              () => ({
                validator(_, value: number) {
                  if (value > 0) {
                    return Promise.resolve();
                  }
                  return Promise.reject(
                    new Error('Must be a positive number!')
                  );
                },
              }),
            ]}
          >
            <InputNumber className={styles.mintAmountInput} />
          </Form.Item>
          <Form.Item>
            <Button
              disabled={
                loadingMintingTime || !account || !account.address || minting
              }
              loading={minting}
              className={styles.mintButton}
              block
              type="primary"
              size="large"
              htmlType="submit"
            >
              Mint
            </Button>
          </Form.Item>
          <Card className={styles.mintInfoCard} loading={loadingMintingTime}>
            {refreshCounter > 0 && publicMintConf && publicMintConf.start && (
              <div>
                <Space direction="vertical">
                  <Space>
                    <strong>Public sale</strong>
                    {!isStarted(publicMintConf.start) && (
                      <Text>
                        {formatDateRange(
                          publicMintConf.start,
                          publicMintConf.end
                        )}
                      </Text>
                    )}
                  </Space>
                  {!isStarted(publicMintConf.start) ? (
                    <Text className={styles.mintTimeText}>
                      {formatDate(publicMintConf.start)}
                    </Text>
                  ) : (
                    <Text className={styles.mintTimeText}>
                      {capitalize(
                        formatDateRange(
                          publicMintConf.start,
                          publicMintConf.end
                        )
                      )}
                    </Text>
                  )}
                </Space>
              </div>
            )}
            <br />
            {refreshCounter > 0 && wlMintConf && wlMintConf.start && (
              <div>
                <Space direction="vertical">
                  <Space>
                    <strong>Presale</strong>
                    {!isStarted(wlMintConf.start) && (
                      <Text>
                        {formatDateRange(wlMintConf.start, wlMintConf.end)}
                      </Text>
                    )}
                  </Space>
                  {!isStarted(wlMintConf.start) ? (
                    <Text className={styles.mintTimeText}>
                      {formatDate(wlMintConf.start)}
                    </Text>
                  ) : (
                    <Text className={styles.mintTimeText}>
                      {capitalize(
                        formatDateRange(wlMintConf.start, wlMintConf.end)
                      )}
                    </Text>
                  )}
                </Space>
              </div>
            )}
          </Card>
        </Form>
      </div>
    </div>
  );
}
