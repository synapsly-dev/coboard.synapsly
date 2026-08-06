import { WebView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { SYNA_ACCOUNT_ORIGIN } from '../../lib/syna';

/**
 * Embedded Syna ID web view. Callers may pass `?url=` to land on a specific Syna
 * ID page (e.g. the membership benefits page); anything outside the Syna ID
 * origin falls back to the account home so this page can never be pointed at a
 * third-party site.
 */
export default function SynaAccountPage(): JSX.Element {
  const requested = Taro.getCurrentInstance().router?.params?.url;
  const target = requested ? decodeURIComponent(requested) : '';
  const src = target.startsWith(SYNA_ACCOUNT_ORIGIN) ? target : `${SYNA_ACCOUNT_ORIGIN}/`;
  return <WebView src={src} />;
}
