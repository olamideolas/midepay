-- Scheduler Authorization headers must not be readable or mutable by application clients.
BEGIN;
DO $request_queue_permissions$
BEGIN
 IF to_regclass('net.http_request_queue') IS NOT NULL THEN
  -- Preserve existing trusted service access before removing inherited PUBLIC grants.
  GRANT ALL ON net.http_request_queue TO service_role;
  REVOKE ALL ON net.http_request_queue FROM PUBLIC,anon,authenticated;
 END IF;
END;
$request_queue_permissions$;
COMMIT;
