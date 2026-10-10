import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api, { setAuthToken } from '../services/api.js';
import { AUTH_STORAGE_KEY, clearStoredSession, isUnauthorizedResponse, parseStoredSession } from '../utils/authSession.js';
const AuthContext = createContext({
  user: null,
  login: async () => {},
  signup: async () => {},
  logout: () => {},
  initialized: false,
  authError: '',
  retrySession: async () => {}
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [initialized, setInitialized] = useState(false);
  const [authError, setAuthError] = useState('');

  const clearSession = useCallback(() => {
    clearStoredSession();
    setAuthToken(null);
    setUser(null);
  }, []);

  const verifyStoredSession = useCallback(async () => {
    setAuthError('');
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!stored) {
      setAuthToken(null);
      setUser(null);
      setInitialized(true);
      return;
    }

    const payload = parseStoredSession(stored);
    if (!payload) {
      clearSession();
      setInitialized(true);
      return;
    }

    setAuthToken(payload.token);
    try {
      const response = await api.get('/auth/me');
      const verifiedUser = response.data.user;
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ token: payload.token, user: verifiedUser }));
      setUser(verifiedUser);
    } catch (error) {
      if (isUnauthorizedResponse(error)) {
        clearSession();
      } else {
        setAuthError('Unable to verify your session. Check your connection and try again.');
      }
    } finally {
      setInitialized(true);
    }
  }, [clearSession]);

  useEffect(() => {
    const interceptorId = api.interceptors.response.use(
      (response) => response,
      (error) => {
        if (isUnauthorizedResponse(error) && localStorage.getItem(AUTH_STORAGE_KEY)) {
          window.dispatchEvent(new Event('rebar:session-expired'));
        }
        return Promise.reject(error);
      }
    );
    const onSessionExpired = () => clearSession();
    window.addEventListener('rebar:session-expired', onSessionExpired);
    verifyStoredSession();

    return () => {
      api.interceptors.response.eject(interceptorId);
      window.removeEventListener('rebar:session-expired', onSessionExpired);
    };
  }, [clearSession, verifyStoredSession]);

  const login = async (email, password) => {
    const response = await api.post('/auth/login', { email, password });
    const payload = response.data;
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(payload));
    setAuthToken(payload.token);
    setUser(payload.user);
    setAuthError('');
    setInitialized(true);
    return payload.user;
  };

  const signup = async (name, email, password) => {
    const response = await api.post('/auth/signup', { name, email, password });
    const payload = response.data;
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(payload));
    setAuthToken(payload.token);
    setUser(payload.user);
    setAuthError('');
    setInitialized(true);
    return payload.user;
  };

  const logout = () => {
    clearSession();
    setAuthError('');
    setInitialized(true);
  };

  const retrySession = async () => {
    setInitialized(false);
    await verifyStoredSession();
  };

  const value = useMemo(
    () => ({ user, login, signup, logout, initialized, authError, retrySession }),
    [user, initialized, authError]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
