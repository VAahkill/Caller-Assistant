import { useEffect, useState } from 'react';

import { currentConfig, loadConfig, onConfigChange, type ServerConfig } from '../lib/api';

/** The saved server, once read from the keystore (`loaded` is false until
 *  then). Updates when the server is connected or forgotten anywhere in the app. */
export function useServerConfig(): { loaded: boolean; config: ServerConfig | null } {
  const [state, setState] = useState(() => ({ loaded: currentConfig() !== null, config: currentConfig() }));
  useEffect(() => {
    let alive = true;
    const off = onConfigChange((config) => alive && setState({ loaded: true, config }));
    loadConfig()
      .then((config) => alive && setState({ loaded: true, config }))
      .catch((e: unknown) => {
        console.warn("Couldn't read the server settings", e);
        if (alive) setState({ loaded: true, config: null });
      });
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}
