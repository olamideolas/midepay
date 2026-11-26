-- STAGING ONLY: ajbhsmcosxgymrtawlmd. Keep direct database monitor login disabled.
BEGIN;
ALTER ROLE midepay_monitor_reader NOLOGIN;
REVOKE ALL ON SCHEMA midepay_monitor FROM midepay_monitor_reader;
REVOKE ALL ON FUNCTION midepay_monitor.get_health() FROM midepay_monitor_reader;
CREATE FUNCTION public.read_staging_monitor_health() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $$SELECT midepay_monitor.get_health()$$;
REVOKE ALL ON FUNCTION public.read_staging_monitor_health() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_staging_monitor_health() TO service_role;
COMMIT;
