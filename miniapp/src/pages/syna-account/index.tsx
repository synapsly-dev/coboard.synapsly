import { WebView } from '@tarojs/components';

const SYNA_ACCOUNT_URL = 'https://accounts.synapsly.org/';

export default function SynaAccountPage(): JSX.Element {
  return <WebView src={SYNA_ACCOUNT_URL} />;
}
