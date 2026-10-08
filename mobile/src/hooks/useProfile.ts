import { useCallback, useEffect, useRef } from 'react';

import { useToast } from '../components/ui/Toast';
import { api } from '../lib/api';
import { useLive } from '../lib/live';
import type { Profile, ProfilePatch } from '../lib/types';
import { errorMessage } from './useAsyncAction';
import { useResource, type Resource } from './useResource';

export interface ProfileResource extends Resource<Profile> {
  /**
   * Saves fields at once on screen and then on the server. If the server
   * refuses, the screen goes back to what was there and the reason is shown.
   * Resolves true when saved.
   */
  patch: (p: ProfilePatch, success?: string) => Promise<boolean>;
}

/** The profile, reloaded when the server says it changed (profile_updated). */
export function useProfile(enabled = true): ProfileResource {
  const { profileKey } = useLive();
  const res = useResource(api.profile, profileKey, enabled);
  const toast = useToast();
  const latest = useRef(res);
  useEffect(() => {
    latest.current = res;
  });

  const patch = useCallback(
    async (p: ProfilePatch, success?: string) => {
      const before = latest.current.data;
      latest.current.mutate((d) => (d ? { ...d, ...p } : d));
      try {
        const saved = await api.patchProfile(p);
        latest.current.mutate(() => saved);
        if (success) toast.success(success);
        return true;
      } catch (e) {
        latest.current.mutate(() => before);
        toast.error(`Not saved. ${errorMessage(e)}`);
        return false;
      }
    },
    [toast],
  );

  return { ...res, patch };
}
