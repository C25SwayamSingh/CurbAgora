# Administration

Platform-level administration and moderation.

**Phase 2 status:** Secure foundation only. The `/admin` route is protected
(platform admin + MFA-verified session required); moderation tools arrive in
a later phase.

## How admin status works

- Admins are rows in the `platform_admins` table.
- That table has **no** insert/update/delete RLS policies and revoked write
  grants for app roles: it can only be written via database migrations or the
  service-role key. There is intentionally no in-app path to grant admin.
- Admin status is never derived from profile fields, URL params, client
  state, or user-editable auth metadata.
- `requirePlatformAdmin()` (server) additionally requires an aal2
  (MFA-verified) session.

## Granting an admin (operators only)

```sql
-- via migration or service-role connection:
insert into public.platform_admins (user_id, note)
values ('<auth user uuid>', 'reason / ticket reference');
```
