import { WebView } from '@tarojs/components';
import { absoluteApiUrl } from '../../platform/http';

export default function AuthLoginPage(): JSX.Element {
  return <WebView src={absoluteApiUrl('/auth/miniapp/start')} />;
}
