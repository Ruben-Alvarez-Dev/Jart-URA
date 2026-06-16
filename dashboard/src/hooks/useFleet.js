import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchRegistry } from '../lib/api';

const POLL_MS = 15000; // mismo cadence que mesh_poll_ms del router

// Live-only fleet (ADR-0001): no mock, no synthetic fallback. Three honest
// states — connecting | live | offline. On a transient failure we keep the
// last good frame and just flip the badge to `offline`; we never invent data.
export function useFleet() {
  const [models, setModels] = useState([]);
  const [conn, setConn] = useState('connecting'); // connecting | live | offline
  const [updatedAt, setUpdatedAt] = useState(null);
  const [hostname, setHostname] = useState(null);
  const timer = useRef(null);
  const abort = useRef(null);

  const load = useCallback(async () => {
    if (abort.current) abort.current.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const { models: live, hostname: host } = await fetchRegistry(ctrl.signal);
      // An empty registry is still LIVE truth (zero models running), not offline.
      setModels(live || []);
      setHostname(host || null);
      setConn('live');
      setUpdatedAt(new Date());
    } catch (err) {
      if (err.name !== 'AbortError') setConn('offline'); // keep last good data
    }
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(load, POLL_MS);
    return () => {
      clearInterval(timer.current);
      if (abort.current) abort.current.abort();
    };
  }, [load]);

  return { models, conn, updatedAt, hostname, refresh: load };
}
