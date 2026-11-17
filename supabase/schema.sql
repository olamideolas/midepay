-- ============================================================================
-- MidePay: Master Database Schema & RLS Policies
-- Target: Supabase SQL Editor / PostgreSQL
-- ============================================================================

\ir ./migrations/20260923000000_initial_midepay_schema.sql
\ir ./migrations/20260924000000_send_money_transfer_funds.sql
\ir ./migrations/20260927000000_executive_role_and_rls.sql
\ir ./migrations/20260928000000_payment_requests.sql
\ir ./migrations/20261116000000_midepay_production.sql
\ir ./migrations/20261116010000_payment_gateways.sql
\ir ./migrations/20261116020000_nuban_and_cards_production.sql
\ir ./migrations/20261116030000_midesave_bills_payroll.sql
\ir ./migrations/20261116040000_backend_security_hardening.sql
\ir ./migrations/20261116050000_auth_verification_gate.sql

\ir ./migrations/20261116060000_independent_review_hardening.sql

\ir ./migrations/20261116070000_email_proof_treasury_controls.sql
