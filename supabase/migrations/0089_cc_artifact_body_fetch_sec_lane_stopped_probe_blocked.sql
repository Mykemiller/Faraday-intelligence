-- CC-ARTIFACT-BODY-FETCH-1.0 Phase 2 step 2a: STOPPED after 3 consecutive SEC blocks (brief rule 3).
-- 21:51 403 "Request Rate Threshold Exceeded" (UA via header) · 21:58 403 "Undeclared Automated Tool"
-- (UA via header) · 22:00 403 "Undeclared Automated Tool" (single UA via CURLOPT_USERAGENT).
-- Zero SEC documents fetched. Lane stays disabled until Myke chooses an access path.
update public.artifact_body_fetch_lanes
   set fetch_enabled = false,
       consecutive_blocks = 3,
       block_events = block_events + 3,
       disabled_reason = 'stopped 2026-09-27 22:00 UTC: 3 consecutive SEC 403s during probe 2a (rate threshold, then undeclared tool x2 with declared UA "Faraday Intelligence LLC mykemiller@gmail.com" from the database egress). Awaiting Myke decision on access path.',
       updated_at = now()
 where lane = 'sec';
