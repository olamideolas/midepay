BEGIN;
CREATE FUNCTION public.has_current_auth_session() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
 SELECT private.has_active_auth_session()
$$;
REVOKE ALL ON FUNCTION public.has_current_auth_session() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.has_current_auth_session() TO authenticated;
COMMIT;
