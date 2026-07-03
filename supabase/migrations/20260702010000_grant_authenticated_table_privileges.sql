-- ============================================================================
-- Fix onboarding failure: grant table privileges required for RLS.
--
-- PostgreSQL requires BOTH table-level GRANTs and RLS policies. The foundation
-- migration enabled RLS and defined policies but never granted SELECT/UPDATE
-- (etc.) to the `authenticated` role. PostgREST/Supabase then returned
-- "permission denied for table profiles" on chooseAccountTypeAction, which
-- surfaced as the generic "Something went wrong" message for both customer
-- and vendor onboarding paths.
--
-- Grants are intentionally minimal and paired with default-deny RLS:
--   * profiles: select + update only (insert via handle_new_user trigger)
--   * organizations: select + update only (insert via create_organization_with_owner)
--   * organization_members: full CRUD where policies exist
--   * platform_admins: select only (no write policies)
-- ============================================================================

grant select, update on public.profiles to authenticated;
grant select, update on public.organizations to authenticated;
grant select, insert, update, delete on public.organization_members to authenticated;
grant select on public.platform_admins to authenticated;

-- Anon may attempt reads; RLS default-deny returns zero rows (never expose data
-- via missing table privileges, which would surface as permission errors).
grant select on public.profiles to anon;
grant select on public.organizations to anon;
grant select on public.organization_members to anon;
grant select on public.platform_admins to anon;
