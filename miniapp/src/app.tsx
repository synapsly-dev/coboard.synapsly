import type { PropsWithChildren } from 'react';
import './app.scss';

export default function App({ children }: PropsWithChildren): JSX.Element {
  return <>{children}</>;
}

