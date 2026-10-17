import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from './api';
import type { LocationRow, User } from './types';

interface Session {
  user: User | null;
  loading: boolean;
  locations: LocationRow[];
  location: LocationRow | null;
  setLocationId: (id: string) => void;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  can: (permission: string) => boolean;
  reloadLocations: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);
const LOCATION_KEY = 'valet.location';

function readLocationId(): string | null {
  try {
    return localStorage.getItem(LOCATION_KEY);
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(Boolean(getToken()));
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [locationId, setLocationIdState] = useState<string | null>(readLocationId());

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setLocations([]);
  }, []);

  const reloadLocations = useCallback(async () => {
    setLocations(await api<LocationRow[]>('/locations'));
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!getToken()) return;
    Promise.all([api<User>('/me'), api<LocationRow[]>('/locations')])
      .then(([me, locs]) => {
        setUser(me);
        setLocations(locs);
      })
      .catch(logout)
      .finally(() => setLoading(false));
  }, [logout]);

  const value = useMemo<Session>(() => {
    const location = locations.find((l) => l.id === locationId) ?? locations[0] ?? null;
    return {
      user,
      loading,
      locations,
      location,
      setLocationId: (id) => {
        setLocationIdState(id);
        try {
          localStorage.setItem(LOCATION_KEY, id);
        } catch {
          // ignore
        }
      },
      login: async (username, password) => {
        const res = await api<{ token: string; user: User }>('/auth/login', { body: { username, password }, auth: false });
        setToken(res.token);
        setUser(res.user);
        setLocations(await api<LocationRow[]>('/locations'));
      },
      logout,
      can: (p) => Boolean(user?.permissions.includes(p)),
      reloadLocations,
    };
  }, [user, loading, locations, locationId, logout, reloadLocations]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}
