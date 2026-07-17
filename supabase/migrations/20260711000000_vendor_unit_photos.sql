-- ============================================================================
-- Vendor unit photos: one optional business photo per vendor unit, stored
-- in a public Supabase Storage bucket ("vendor-photos").
--
-- vendor_units.primary_image_path holds the storage OBJECT PATH (never a
-- signed URL) shaped as {organization_id}/{vendor_unit_id}/{filename}.
-- The bucket is public — the photo is meant to be shown on the public unit
-- page — but writes (upload/replace/delete) are owner/manager-only,
-- matching vendor_units CRUD: managing the listing's photo is "editing the
-- listing", not an operational action like going live.
--
-- The bucket is created here (not only in config.toml) so it exists in
-- every environment migrations run against, with the size/MIME limits
-- enforced by the storage API itself as a second layer beneath the app's
-- own validation. Hosted Supabase projects that restrict DDL on the
-- storage schema may require creating these policies via the dashboard
-- instead; local development applies them directly.
-- ============================================================================

alter table public.vendor_units
  add column primary_image_path text;

alter table public.vendor_units
  add constraint vendor_units_primary_image_path_length check (
    primary_image_path is null or char_length(primary_image_path) <= 512
  );

comment on column public.vendor_units.primary_image_path is
  'Storage object path (not a URL) of the unit''s optional business photo '
  'in the public vendor-photos bucket, shaped as '
  '{organization_id}/{vendor_unit_id}/{filename}. Null = no photo; the UI '
  'falls back to an initials avatar.';

-- The view depends on this table's column list and must be dropped before
-- new columns can be inserted mid-list (create-or-replace only allows
-- appending), then recreated identically plus the new column.
drop view public.vendor_unit_previews;

create view public.vendor_unit_previews as
select
  vu.id,
  vu.organization_id,
  o.slug as organization_slug,
  vu.slug,
  vu.name,
  vu.unit_type,
  vu.description,
  vu.cuisine_categories,
  vu.city,
  vu.state,
  vu.neighborhood,
  vu.primary_image_path,
  vu.payment_methods,
  vu.operating_status,
  case when vu.contact_phone_visible then vu.contact_phone else null end as contact_phone,
  case when vu.contact_email_visible then vu.contact_email else null end as contact_email,
  vu.created_at,
  vu.updated_at
from public.vendor_units vu
join public.organizations o on o.id = vu.organization_id
where o.status = 'active';

comment on view public.vendor_unit_previews is
  'Public, unauthenticated-safe projection of vendor_units: contact fields '
  'are nulled unless their *_visible flag is set, and only units under an '
  'active organization are included. Exposes organizations.slug as '
  'organization_slug and the unit''s own slug, together forming the public '
  'URL /vendors/{organization_slug}/{slug}. Runs with the view owner''s '
  'privileges (no security_invoker), which is what lets it read across '
  'every organization despite the member-only RLS on vendor_units and '
  'organizations — this is intentional and is the only public read path '
  'for vendor unit data.';

grant select on public.vendor_unit_previews to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Storage bucket + policies
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vendor-photos',
  'vendor-photos',
  true,
  5242880, -- 5 MiB, mirrored by the app-layer validation in photo.ts
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Anyone may read: the bucket is public and photos appear on public pages.
create policy "vendor_photos_public_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'vendor-photos');

-- Writes require the object path's TWO leading folders to be a real
-- (organization_id, vendor_unit_id) pair — the exists() re-derives that
-- relationship from vendor_units rather than trusting the path, exactly
-- like the cross-org exists() guard on vendor_location_sessions: without
-- it, an owner of Org B could upload into a path that names Org B but
-- another org's unit id (or vice versa) and misattribute a photo
-- cross-tenant. Comparing as text (vu.id::text = path segment) never
-- throws on a malformed path, unlike casting the path segment to uuid.
-- Inside the exists() the object's path MUST be qualified as objects.name:
-- unqualified, it resolves to vu.name (vendor_units' own column) and the
-- policy silently checks the wrong value.
create policy "vendor_photos_insert_owner_manager"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'vendor-photos'
    and array_length(storage.foldername(name), 1) = 2
    and exists (
      select 1
      from public.vendor_units vu
      where vu.id::text = (storage.foldername(objects.name))[2]
        and vu.organization_id::text = (storage.foldername(objects.name))[1]
        and public.has_org_role(vu.organization_id, array['owner', 'manager']::public.organization_role[])
    )
  );

create policy "vendor_photos_delete_owner_manager"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'vendor-photos'
    and array_length(storage.foldername(name), 1) = 2
    and exists (
      select 1
      from public.vendor_units vu
      where vu.id::text = (storage.foldername(objects.name))[2]
        and vu.organization_id::text = (storage.foldername(objects.name))[1]
        and public.has_org_role(vu.organization_id, array['owner', 'manager']::public.organization_role[])
    )
  );

-- No UPDATE policy on purpose: replacement is always upload-new-then-
-- delete-old under a fresh random filename (which also busts CDN/browser
-- caches), so in-place object updates stay denied by default.
