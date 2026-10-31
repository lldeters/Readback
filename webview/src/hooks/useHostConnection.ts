import { useEffect, useEffectEvent } from 'react';
import {
  isHostToWebviewMessage,
  type HostToWebviewMessage,
} from '../../../src/shared/webviewProtocol';
import type { HostApi } from '../hostApi';

/**
 * Listens for host messages and then announces the page with 'ready'. Both happen in one effect so
 * the listener is in place before the host answers. The host sends the current graph in reply,
 * also after every reload of the page.
 */
export function useHostConnection(
  host: HostApi,
  onMessage: (message: HostToWebviewMessage) => void,
): void {
  const deliver = useEffectEvent(onMessage);
  useEffect(() => {
    const listener = (event: MessageEvent<unknown>): void => {
      // Anything else arriving on the window is not from the extension host.
      if (isHostToWebviewMessage(event.data)) {
        deliver(event.data);
      }
    };
    window.addEventListener('message', listener);
    host.postMessage({ type: 'ready' });
    return () => {
      window.removeEventListener('message', listener);
    };
  }, [host]);
}
