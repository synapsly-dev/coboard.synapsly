import { WebView } from '@tarojs/components';

const SYNA_ACCOUNT_URL = 'https://auth.synapsly.org/account';

export default function SynaAccountPage(): JSX.Element {
  return <WebView src={SYNA_ACCOUNT_URL} />;
}
