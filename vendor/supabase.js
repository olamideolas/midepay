/**
 * MidePay — Self-Hosted Zero-Dependency Supabase v2 Browser Gateway (`'self'` CSP Compliant)
 * Eliminates third-party CDN script dependencies (`cdn.jsdelivr.net`) while speaking
 * native Supabase GoTrue v2, PostgREST v2 (`SELECT` + `SECURITY DEFINER` RPCs), and Edge Functions.
 * If `window.supabase` is already pre-injected (e.g. in headless QA harnesses), preserves it untouched.
 */
(function (global) {
  'use strict';

  if (global.supabase && typeof global.supabase.createClient === 'function') {
    return;
  }

  function createClient(supabaseUrl, supabaseKey, options) {
    const baseUrl = String(supabaseUrl || '').replace(/\/+$/, '');
    const apiKey = String(supabaseKey || '');
    const storageKey = 'sb-' + (baseUrl.split('//')[1] || 'midepay').split('.')[0] + '-auth-token';
    const persistSession = options?.auth?.persistSession !== false;
    const authListeners = new Set();

    function readSession() {
      if (!persistSession || typeof localStorage === 'undefined') return null;
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && parsed.access_token ? parsed : null;
      } catch (_) {
        return null;
      }
    }

    function writeSession(session) {
      if (!persistSession || typeof localStorage === 'undefined') return;
      try {
        if (!session) localStorage.removeItem(storageKey);
        else localStorage.setItem(storageKey, JSON.stringify(session));
      } catch (_) {}
    }

    function notifyAuth(event, session) {
      authListeners.forEach((cb) => {
        try { cb(event, session); } catch (_) {}
      });
    }

    function buildHeaders(extraHeaders, useBearer) {
      const session = readSession();
      const bearer = useBearer !== false && session?.access_token ? session.access_token : apiKey;
      return Object.assign(
        {
          apikey: apiKey,
          Authorization: 'Bearer ' + bearer,
          'Content-Type': 'application/json'
        },
        extraHeaders || {}
      );
    }

    async function parseJsonSafe(res) {
      const text = await res.text();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch (_) {
        return { message: text };
      }
    }

    function normalizeAuthError(payload, status) {
      const msg =
        payload?.msg ||
        payload?.error_description ||
        payload?.message ||
        payload?.error ||
        'Authentication request failed (' + status + ')';
      const err = new Error(String(msg));
      err.status = status;
      return err;
    }

    const auth = {
      async signUp({ email, password, options: signUpOpts } = {}) {
        try {
          const res = await fetch(baseUrl + '/auth/v1/signup', {
            method: 'POST',
            headers: buildHeaders({}, false),
            body: JSON.stringify({
              email,
              password,
              data: signUpOpts?.data || {}
            })
          });
          const body = await parseJsonSafe(res);
          if (!res.ok) {
            return { data: { user: null, session: null }, error: normalizeAuthError(body, res.status) };
          }
          const session = body?.access_token ? body : (body?.session || null);
          const user = body?.user || (body?.id ? body : null);
          if (session?.access_token) {
            writeSession(session);
            notifyAuth('SIGNED_IN', session);
          }
          return { data: { user, session }, error: null };
        } catch (err) {
          return { data: { user: null, session: null }, error: err };
        }
      },

      async verifyOtp({ email, token, type = 'signup' } = {}) {
        try {
          const res = await fetch(baseUrl + '/auth/v1/verify', {
            method: 'POST',
            headers: buildHeaders({}, false),
            body: JSON.stringify({ email, token, type })
          });
          const body = await parseJsonSafe(res);
          if (!res.ok) {
            return { data: { user: null, session: null }, error: normalizeAuthError(body, res.status) };
          }
          const session = body?.access_token ? body : (body?.session || null);
          const user = body?.user || session?.user || null;
          if (session?.access_token) {
            writeSession(session);
            notifyAuth('SIGNED_IN', session);
          }
          return { data: { user, session }, error: null };
        } catch (err) {
          return { data: { user: null, session: null }, error: err };
        }
      },

      async resend({ type = 'signup', email } = {}) {
        try {
          const res = await fetch(baseUrl + '/auth/v1/resend', {
            method: 'POST',
            headers: buildHeaders({}, false),
            body: JSON.stringify({ type, email })
          });
          const body = await parseJsonSafe(res);
          if (!res.ok) {
            return { data: {}, error: normalizeAuthError(body, res.status) };
          }
          return { data: body || {}, error: null };
        } catch (err) {
          return { data: {}, error: err };
        }
      },

      async signInWithPassword({ email, password } = {}) {
        try {
          const res = await fetch(baseUrl + '/auth/v1/token?grant_type=password', {
            method: 'POST',
            headers: buildHeaders({}, false),
            body: JSON.stringify({ email, password })
          });
          const body = await parseJsonSafe(res);
          if (!res.ok) {
            return { data: { user: null, session: null }, error: normalizeAuthError(body, res.status) };
          }
          const session = body?.access_token ? body : null;
          const user = body?.user || null;
          if (session) {
            writeSession(session);
            notifyAuth('SIGNED_IN', session);
          }
          return { data: { user, session }, error: null };
        } catch (err) {
          return { data: { user: null, session: null }, error: err };
        }
      },

      async signOut() {
        const session = readSession();
        writeSession(null);
        notifyAuth('SIGNED_OUT', null);
        if (session?.access_token) {
          try {
            await fetch(baseUrl + '/auth/v1/logout', {
              method: 'POST',
              headers: buildHeaders({ Authorization: 'Bearer ' + session.access_token }, false)
            });
          } catch (_) {}
        }
        return { error: null };
      },

      async getSession() {
        const session = readSession();
        return { data: { session }, error: null };
      },

      async getUser() {
        const session = readSession();
        if (!session?.access_token) {
          return { data: { user: null }, error: null };
        }
        try {
          const res = await fetch(baseUrl + '/auth/v1/user', {
            method: 'GET',
            headers: buildHeaders({}, true)
          });
          const body = await parseJsonSafe(res);
          if (!res.ok) {
            if (res.status === 401 || res.status === 403) writeSession(null);
            return { data: { user: null }, error: normalizeAuthError(body, res.status) };
          }
          return { data: { user: body }, error: null };
        } catch (err) {
          return { data: { user: session.user || null }, error: err };
        }
      },

      onAuthStateChange(callback) {
        if (typeof callback === 'function') authListeners.add(callback);
        return {
          data: {
            subscription: {
              unsubscribe() {
                authListeners.delete(callback);
              }
            }
          }
        };
      }
    };

    function from(table) {
      const params = new URLSearchParams();
      params.set('select', '*');
      let singleMode = null;

      async function runSelect() {
        try {
          const url = baseUrl + '/rest/v1/' + encodeURIComponent(table) + '?' + params.toString();
          const res = await fetch(url, {
            method: 'GET',
            headers: buildHeaders({ Accept: 'application/json' }, true)
          });
          const body = await parseJsonSafe(res);
          if (!res.ok) {
            return {
              data: null,
              error: { message: body?.message || body?.error || 'PostgREST query failed', code: body?.code }
            };
          }
          const rows = Array.isArray(body) ? body : (body ? [body] : []);
          if (singleMode === 'maybeSingle') {
            return { data: rows[0] || null, error: null };
          }
          if (singleMode === 'single') {
            return rows[0]
              ? { data: rows[0], error: null }
              : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } };
          }
          return { data: rows, error: null };
        } catch (err) {
          return { data: null, error: { message: err.message || 'Network error' } };
        }
      }

      const builder = {
        select(columns) {
          params.set('select', columns ? String(columns).replace(/\s+/g, '') : '*');
          return builder;
        },
        eq(col, val) {
          params.append(col, 'eq.' + String(val));
          return builder;
        },
        neq(col, val) {
          params.append(col, 'neq.' + String(val));
          return builder;
        },
        ilike(col, val) {
          params.append(col, 'ilike.' + String(val));
          return builder;
        },
        or(expr) {
          params.set('or', '(' + String(expr) + ')');
          return builder;
        },
        order(col, opts) {
          const dir = opts && opts.ascending === false ? 'desc' : 'asc';
          params.set('order', String(col) + '.' + dir);
          return builder;
        },
        limit(count) {
          params.set('limit', String(Number(count) || 20));
          return builder;
        },
        maybeSingle() {
          singleMode = 'maybeSingle';
          params.set('limit', '1');
          return runSelect();
        },
        single() {
          singleMode = 'single';
          params.set('limit', '1');
          return runSelect();
        },
        then(resolve, reject) {
          return runSelect().then(resolve, reject);
        }
      };

      return builder;
    }

    async function rpc(fnName, args) {
      try {
        const res = await fetch(baseUrl + '/rest/v1/rpc/' + encodeURIComponent(fnName), {
          method: 'POST',
          headers: buildHeaders({ Accept: 'application/json' }, true),
          body: JSON.stringify(args || {})
        });
        const body = await parseJsonSafe(res);
        if (!res.ok) {
          return {
            data: null,
            error: {
              message: body?.message || body?.hint || body?.details || body?.error || 'RPC failed',
              code: body?.code
            }
          };
        }
        return { data: body, error: null };
      } catch (err) {
        return { data: null, error: { message: err.message || 'RPC network error' } };
      }
    }

    const functions = {
      async invoke(fnName, invokeOpts) {
        try {
          const res = await fetch(baseUrl + '/functions/v1/' + encodeURIComponent(fnName), {
            method: (invokeOpts && invokeOpts.method) || 'POST',
            headers: buildHeaders(invokeOpts?.headers || {}, true),
            body: invokeOpts?.body !== undefined ? JSON.stringify(invokeOpts.body) : undefined
          });
          const body = await parseJsonSafe(res);
          if (!res.ok) {
            return {
              data: body,
              error: { message: body?.error || body?.message || 'Edge Function invocation failed' }
            };
          }
          return { data: body, error: null };
        } catch (err) {
          return { data: null, error: { message: err.message || 'Edge Function network error' } };
        }
      }
    };

    return { auth, from, rpc, functions };
  }

  global.supabase = { createClient };
})(typeof window !== 'undefined' ? window : globalThis);

