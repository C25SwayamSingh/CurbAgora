/**
 * Database types for the Phase 2 auth/tenancy schema plus vendor_units.
 *
 * Maintained by hand to mirror
 * `supabase/migrations/20260701000000_auth_tenancy_foundation.sql`,
 * `supabase/migrations/20260706000000_vendor_units.sql`, and later forward
 * migrations (multi-unit slugs, free-form cuisine tags, city/state,
 * vendor_location_sessions).
 * When a local Supabase stack is available, regenerate with:
 *
 *   supabase gen types typescript --local > src/lib/supabase/database.types.ts
 *
 * and re-apply the helper aliases at the bottom if they are lost.
 */

export type AccountType = "customer" | "vendor";
/** Non-authoritative UI preference; does not grant vendor access. */
export type PreferredMode = "customer" | "vendor";
export type OnboardingStatus = "not_started" | "in_progress" | "complete";
export type OrganizationStatus = "active" | "suspended" | "archived";
export type OrganizationRole = "owner" | "manager" | "staff";

/** Where a piece of location knowledge came from. */
export type LocationSourceType =
  | "VENDOR_LIVE"
  | "VENDOR_RECURRING"
  | "VENDOR_SCHEDULED"
  | "EVENT_ORGANIZER"
  | "MUNICIPAL_OPEN_DATA"
  | "THIRD_PARTY_SCHEDULE"
  | "SOCIAL_MEDIA_LEAD"
  | "COMMUNITY_REPORT";

/** How much that source has been vouched for. */
export type LocationVerification =
  "CONFIRMED" | "EXPECTED" | "UNVERIFIED" | "STALE" | "REJECTED";

/**
 * The four public location states, as returned by nearby_vendor_locations.
 * Ordered by the rank the query assigns them.
 */
export type LocationState =
  "LIVE" | "SCHEDULED_NOW" | "RECURRING_NOW" | "SCHEDULED_UPCOMING" | "HOTSPOT";

/**
 * One ranked discovery result. `vendor_unit_id` and every vendor field are
 * null for a HOTSPOT — a hotspot is a place, and the type says so.
 */
export type NearbyVendorLocation = {
  result_id: string;
  state: LocationState;
  rank: number;
  vendor_unit_id: string | null;
  organization_slug: string | null;
  unit_slug: string | null;
  name: string | null;
  unit_type: VendorUnitType | null;
  cuisine_categories: string[] | null;
  primary_image_path: string | null;
  latitude: number;
  longitude: number;
  public_label: string;
  reason_label: string;
  source_type: LocationSourceType;
  verification: LocationVerification;
  last_verified_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  distance_miles: number;
};
export type MembershipStatus = "invited" | "active" | "revoked";
export type VendorUnitType =
  "food_cart" | "food_truck" | "stand" | "stall" | "pop_up";
export type VendorOperatingStatus = "open" | "closed" | "temporarily_closed";
/**
 * Free-form cuisine tag: a mix of predefined suggestions (see
 * CUISINE_CATEGORIES in src/features/vendors/schemas.ts) and custom
 * vendor-entered values. Plain text in the database since
 * 20260708000000_vendor_units_custom_cuisines.sql — no longer a DB enum.
 */
export type CuisineCategory = string;
export type PaymentMethod =
  "cash" | "credit_card" | "debit_card" | "mobile_pay" | "contactless";
export type LoyaltyEntryType =
  | "PURCHASE_POINTS"
  | "PROMO_BONUS"
  | "REDEMPTION"
  | "REVERSAL"
  | "MANUAL_ADJUSTMENT"
  // retained for historical stamp-era rows:
  | "PURCHASE_STAMP"
  | "FIRST_VISIT_BONUS";
export type LoyaltyProgramVersionStatus = "active" | "archived";

/**
 * How a reward is priced. FREE_ITEM has cost leverage (menu price ≫ vendor
 * cost); FIXED_DISCOUNT costs its full face value. Kept explicit so the two
 * are never modeled interchangeably.
 */
export type LoyaltyRewardKind = "FREE_ITEM" | "FIXED_DISCOUNT";

/** One reward tier as exposed on the public program preview. */
export type LoyaltyCatalogPreviewItem = {
  id: string;
  points_cost: number;
  reward_kind: LoyaltyRewardKind;
  reward_name: string;
  reward_value_cents: number;
};
/**
 * Checkout-session lifecycle. `pending` is ACTIVE and `confirmed` is CONSUMED
 * — the lowercase names are kept from the stamp era so historical rows and
 * their ledger references stay valid. `locked` is set after repeated failed
 * lookups against the same session.
 */
export type LoyaltyClaimStatus =
  "pending" | "confirmed" | "cancelled" | "expired" | "locked";
export type LoyaltyRedemptionStatus =
  "requested" | "redeemed" | "cancelled" | "expired";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          avatar_url: string | null;
          /** @deprecated Authorization uses organization_members, not this field. */
          account_type: AccountType | null;
          preferred_mode: PreferredMode;
          onboarding_status: OnboardingStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name?: string;
          avatar_url?: string | null;
          account_type?: AccountType | null;
          preferred_mode?: PreferredMode;
          onboarding_status?: OnboardingStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string;
          avatar_url?: string | null;
          account_type?: AccountType | null;
          preferred_mode?: PreferredMode;
          onboarding_status?: OnboardingStatus;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      organizations: {
        Row: {
          id: string;
          legal_name: string;
          display_name: string;
          slug: string;
          status: OrganizationStatus;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          legal_name: string;
          display_name: string;
          slug: string;
          status?: OrganizationStatus;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          legal_name?: string;
          display_name?: string;
          slug?: string;
          status?: OrganizationStatus;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      /**
       * `token_digest` is deliberately absent: it is excluded from the
       * `authenticated` column grant, so no client query can return it.
       */
      organization_invitations: {
        Row: {
          id: string;
          organization_id: string;
          email: string;
          role: OrganizationRole;
          first_name: string;
          status: "pending" | "accepted" | "revoked" | "expired";
          invited_by: string;
          expires_at: string;
          accepted_at: string | null;
          accepted_by: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      organization_members: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          role: OrganizationRole;
          status: MembershipStatus;
          invited_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          user_id: string;
          role?: OrganizationRole;
          status?: MembershipStatus;
          invited_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          user_id?: string;
          role?: OrganizationRole;
          status?: MembershipStatus;
          invited_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      platform_admins: {
        Row: {
          user_id: string;
          granted_by: string | null;
          note: string | null;
          created_at: string;
        };
        Insert: {
          user_id: string;
          granted_by?: string | null;
          note?: string | null;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          granted_by?: string | null;
          note?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      vendor_units: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          slug: string;
          unit_type: VendorUnitType;
          description: string;
          cuisine_categories: CuisineCategory[];
          city: string;
          state: string | null;
          neighborhood: string | null;
          /** Storage object path in the vendor-photos bucket; null = no photo. */
          primary_image_path: string | null;
          contact_phone: string | null;
          contact_phone_visible: boolean;
          contact_email: string | null;
          contact_email_visible: boolean;
          payment_methods: PaymentMethod[];
          operating_status: VendorOperatingStatus;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          slug: string;
          unit_type: VendorUnitType;
          description?: string;
          cuisine_categories?: CuisineCategory[];
          city: string;
          state?: string | null;
          neighborhood?: string | null;
          primary_image_path?: string | null;
          contact_phone?: string | null;
          contact_phone_visible?: boolean;
          contact_email?: string | null;
          contact_email_visible?: boolean;
          payment_methods?: PaymentMethod[];
          operating_status?: VendorOperatingStatus;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          slug?: string;
          unit_type?: VendorUnitType;
          description?: string;
          cuisine_categories?: CuisineCategory[];
          city?: string;
          state?: string | null;
          neighborhood?: string | null;
          primary_image_path?: string | null;
          contact_phone?: string | null;
          contact_phone_visible?: boolean;
          contact_email?: string | null;
          contact_email_visible?: boolean;
          payment_methods?: PaymentMethod[];
          operating_status?: VendorOperatingStatus;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      vendor_recurring_locations: {
        Row: {
          id: string;
          organization_id: string;
          vendor_unit_id: string;
          latitude: number;
          longitude: number;
          public_label: string;
          timezone: string;
          days_of_week: number[];
          start_time: string;
          end_time: string;
          effective_from: string | null;
          effective_to: string | null;
          is_active: boolean;
          last_confirmed_at: string;
          created_by: string;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      vendor_scheduled_occurrences: {
        Row: {
          id: string;
          organization_id: string | null;
          vendor_unit_id: string | null;
          organizer_name: string | null;
          event_name: string | null;
          starts_at: string;
          ends_at: string;
          latitude: number;
          longitude: number;
          public_label: string;
          status: "scheduled" | "cancelled" | "completed";
          source_type: LocationSourceType;
          source_url: string | null;
          source_record_id: string | null;
          verification: LocationVerification;
          confirmed_at: string | null;
          confirmed_by: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /**
       * A place, never a vendor. There is deliberately no vendor_unit_id:
       * association is a reviewer action that creates a separate vendor-owned
       * row, so an import can never claim a vendor.
       */
      location_hotspots: {
        Row: {
          id: string;
          latitude: number;
          longitude: number;
          boundary: Json | null;
          public_name: string;
          source_type: LocationSourceType;
          source_url: string | null;
          source_record_id: string | null;
          valid_from: string | null;
          valid_until: string | null;
          last_imported_at: string | null;
          verification: LocationVerification;
          review_notes: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      location_reports: {
        Row: {
          id: string;
          reported_by: string | null;
          latitude: number;
          longitude: number;
          note: string | null;
          vendor_unit_id: string | null;
          source_type: LocationSourceType;
          verification: LocationVerification;
          review_notes: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      vendor_location_sessions: {
        Row: {
          id: string;
          vendor_unit_id: string;
          organization_id: string;
          latitude: number;
          longitude: number;
          public_label: string;
          started_at: string;
          expected_end_at: string | null;
          last_confirmed_at: string;
          ended_at: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          vendor_unit_id: string;
          organization_id: string;
          latitude: number;
          longitude: number;
          public_label?: string;
          started_at?: string;
          expected_end_at?: string | null;
          last_confirmed_at?: string;
          ended_at?: string | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          vendor_unit_id?: string;
          organization_id?: string;
          latitude?: number;
          longitude?: number;
          public_label?: string;
          started_at?: string;
          expected_end_at?: string | null;
          last_confirmed_at?: string;
          ended_at?: string | null;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      loyalty_programs: {
        Row: {
          id: string;
          organization_id: string;
          earning_paused: boolean;
          redemption_paused: boolean;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      loyalty_program_versions: {
        Row: {
          id: string;
          program_id: string;
          organization_id: string;
          version_number: number;
          status: LoyaltyProgramVersionStatus;
          /** Points earned per verified dollar of eligible spend. */
          points_per_dollar: number | null;
          advisor_snapshot: Json | null;
          created_by: string;
          created_at: string;
          // Retained stamp-era columns (unused by the points model).
          stamps_required: number | null;
          qualifying_min_cents: number | null;
          stamp_period_minutes: number | null;
          reward_name: string | null;
          reward_retail_value_cents: number | null;
          reward_est_cost_cents: number | null;
          reward_kind: LoyaltyRewardKind;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      loyalty_reward_catalog_items: {
        Row: {
          id: string;
          program_version_id: string;
          organization_id: string;
          sort_index: number;
          points_cost: number;
          reward_kind: LoyaltyRewardKind;
          reward_name: string;
          /** Menu price for a free item; discount face value for a discount. */
          reward_value_cents: number;
          reward_est_cost_cents: number | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      loyalty_accounts: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          point_balance: number;
          lifetime_points: number;
          created_at: string;
          updated_at: string;
          // Retained stamp-era columns (unused by the points model).
          stamp_balance: number;
          lifetime_stamps: number;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /**
       * Checkout sessions. Named for the stamp-era claim codes it grew out of;
       * a row is now identified by a QR token digest plus a 4-digit code.
       * Secret columns (`code`, `numeric_code`, `token_digest`) are not
       * granted to `authenticated` — they resolve only through the definer
       * functions, so they are absent from anything a client can select.
       */
      loyalty_claim_codes: {
        Row: {
          id: string;
          account_id: string;
          organization_id: string;
          vendor_unit_id: string | null;
          status: LoyaltyClaimStatus;
          expires_at: string;
          confirmed_by: string | null;
          confirmed_at: string | null;
          created_at: string;
          failed_attempts: number;
          invalidated_reason: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      loyalty_checkout_lookups: {
        Row: {
          id: string;
          organization_id: string;
          actor_user_id: string;
          method: "qr" | "code4";
          outcome:
            "resolved" | "not_found" | "expired" | "consumed" | "throttled";
          session_id: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      loyalty_redemptions: {
        Row: {
          id: string;
          account_id: string;
          organization_id: string;
          program_version_id: string;
          code: string;
          status: LoyaltyRedemptionStatus;
          points_spent: number | null;
          catalog_item_id: string | null;
          reward_name: string;
          expires_at: string;
          confirmed_by: string | null;
          confirmed_at: string | null;
          created_at: string;
          /** Retained stamp-era column. */
          stamps_spent: number | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      loyalty_ledger_entries: {
        Row: {
          id: string;
          account_id: string;
          organization_id: string;
          program_version_id: string;
          entry_type: LoyaltyEntryType;
          delta_points: number | null;
          verified_subtotal_cents: number | null;
          reason: string | null;
          idempotency_key: string;
          reverses_entry_id: string | null;
          claim_code_id: string | null;
          redemption_id: string | null;
          actor_user_id: string;
          created_at: string;
          /** Retained stamp-era column. */
          delta_stamps: number | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: {
      loyalty_program_previews: {
        Row: {
          organization_id: string;
          organization_slug: string;
          organization_name: string;
          earning_paused: boolean;
          redemption_paused: boolean;
          program_version_id: string;
          points_per_dollar: number;
          catalog: LoyaltyCatalogPreviewItem[];
        };
        Relationships: [];
      };
      vendor_unit_previews: {
        Row: {
          id: string;
          organization_id: string;
          organization_slug: string;
          slug: string;
          name: string;
          unit_type: VendorUnitType;
          description: string;
          cuisine_categories: CuisineCategory[];
          city: string;
          state: string | null;
          neighborhood: string | null;
          /** Storage object path in the vendor-photos bucket; null = no photo. */
          primary_image_path: string | null;
          payment_methods: PaymentMethod[];
          operating_status: VendorOperatingStatus;
          /** Null unless the owner/manager set contact_phone_visible. */
          contact_phone: string | null;
          /** Null unless the owner/manager set contact_email_visible. */
          contact_email: string | null;
          created_at: string;
          updated_at: string;
        };
        Relationships: [];
      };
      vendor_location_session_previews: {
        Row: {
          id: string;
          vendor_unit_id: string;
          organization_id: string;
          organization_slug: string;
          unit_slug: string;
          latitude: number;
          longitude: number;
          public_label: string;
          started_at: string;
          expected_end_at: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      organization_create_invitation: {
        Args: {
          p_organization_id: string;
          p_email: string;
          p_role: OrganizationRole;
          p_first_name: string;
          p_token_digest: string;
        };
        Returns: { invitation_id: string; expires_at: string }[];
      };
      organization_invitation_preview: {
        Args: { p_token_digest: string };
        /** Every column but `outcome` is null when the token is unknown. */
        Returns: {
          outcome: string;
          organization_name: string | null;
          role: OrganizationRole | null;
          first_name: string | null;
          invited_email: string | null;
          expires_at: string | null;
        }[];
      };
      organization_accept_invitation: {
        Args: { p_token_digest: string };
        Returns: { organization_id: string; role: OrganizationRole }[];
      };
      organization_revoke_invitation: {
        Args: { p_invitation_id: string };
        Returns: undefined;
      };
      create_organization_with_owner: {
        Args: {
          p_legal_name: string;
          p_display_name: string;
          p_slug: string;
        };
        Returns: Database["public"]["Tables"]["organizations"]["Row"];
      };
      is_platform_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      is_org_member: {
        Args: { target_org: string };
        Returns: boolean;
      };
      has_org_role: {
        Args: { target_org: string; allowed_roles: OrganizationRole[] };
        Returns: boolean;
      };
      mfa_assurance_ok: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      loyalty_publish_program: {
        Args: {
          p_organization_id: string;
          p_points_per_dollar: number;
          p_catalog: Json;
          p_advisor_snapshot?: Json | null;
        };
        Returns: string;
      };
      loyalty_set_program_paused: {
        Args: {
          p_organization_id: string;
          p_earning_paused: boolean;
          p_redemption_paused: boolean;
        };
        Returns: undefined;
      };
      loyalty_start_checkout_session: {
        Args: {
          p_organization_id: string;
          p_token_digest: string;
          p_code_candidates: string[];
          /**
           * Optional in SQL, but always send it — even as null. PostgREST
           * matches on the full named-argument set, so omitting the key
           * resolves to no function at all (PGRST202).
           */
          p_vendor_unit_id: string | null;
        };
        Returns: {
          session_id: string;
          numeric_code: string;
          expires_at: string;
        }[];
      };
      loyalty_resolve_checkout_session: {
        Args: {
          p_organization_id: string;
          p_method: "qr" | "code4";
          /** Token DIGEST for `qr`, the 4 digits for `code4`. */
          p_value: string;
        };
        /**
         * A miss returns `outcome` with every other column null, rather than
         * raising — an exception would roll back the audit row the rate
         * limiter counts. Only `outcome: "resolved"` carries member data.
         */
        Returns: {
          outcome:
            "resolved" | "not_found" | "expired" | "consumed" | "throttled";
          session_id: string | null;
          display_name: string | null;
          member_ref: string | null;
          point_balance: number | null;
          expires_at: string | null;
        }[];
      };
      loyalty_award_points: {
        Args: {
          p_organization_id: string;
          p_session_id: string;
          p_eligible_subtotal_cents: number;
        };
        Returns: { points_awarded: number; point_balance: number }[];
      };
      loyalty_cancel_checkout_session: {
        Args: { p_session_id: string };
        Returns: undefined;
      };
      loyalty_checkout_session_status: {
        Args: { p_session_id: string };
        Returns: {
          status: LoyaltyClaimStatus;
          expires_at: string;
          points_awarded: number;
          point_balance: number;
        }[];
      };
      loyalty_request_redemption: {
        Args: { p_organization_id: string; p_catalog_item_id: string };
        Returns: { code: string; reward_name: string; expires_at: string }[];
      };
      loyalty_confirm_redemption: {
        Args: { p_organization_id: string; p_code: string };
        Returns: { reward_name: string; remaining_balance: number }[];
      };
      loyalty_reverse_entry: {
        Args: { p_entry_id: string; p_reason: string };
        Returns: undefined;
      };
      loyalty_adjust_balance: {
        Args: {
          p_account_id: string;
          p_delta_points: number;
          p_reason: string;
        };
        Returns: undefined;
      };
      loyalty_program_stats: {
        Args: { p_organization_id: string };
        Returns: {
          members: number;
          points_issued: number;
          rewards_redeemed: number;
          outstanding_points: number;
          estimated_liability_cents: number;
        }[];
      };
      nearby_vendor_locations: {
        Args: {
          p_latitude: number;
          p_longitude: number;
          p_radius_miles: number;
          p_include_live?: boolean;
          p_include_scheduled?: boolean;
          p_include_recurring?: boolean;
          /** Off by default: real vendors outrank empty parking spots. */
          p_include_hotspots?: boolean;
        };
        Returns: NearbyVendorLocation[];
      };
      nearby_live_vendors: {
        Args: {
          p_latitude: number;
          p_longitude: number;
          p_radius_miles: number;
        };
        Returns: {
          vendor_unit_id: string;
          organization_id: string;
          organization_slug: string;
          unit_slug: string;
          name: string;
          unit_type: VendorUnitType;
          cuisine_categories: CuisineCategory[];
          city: string;
          state: string | null;
          neighborhood: string | null;
          primary_image_path: string | null;
          operating_status: VendorOperatingStatus;
          latitude: number;
          longitude: number;
          public_label: string;
          started_at: string;
          expected_end_at: string | null;
          distance_miles: number;
        }[];
      };
    };
    Enums: {
      account_type: AccountType;
      preferred_mode: PreferredMode;
      onboarding_status: OnboardingStatus;
      organization_status: OrganizationStatus;
      organization_role: OrganizationRole;
      membership_status: MembershipStatus;
      vendor_unit_type: VendorUnitType;
      vendor_operating_status: VendorOperatingStatus;
      payment_method: PaymentMethod;
    };
    CompositeTypes: Record<string, never>;
  };
};

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Organization = Database["public"]["Tables"]["organizations"]["Row"];
export type OrganizationMember =
  Database["public"]["Tables"]["organization_members"]["Row"];
export type PlatformAdmin =
  Database["public"]["Tables"]["platform_admins"]["Row"];
export type VendorUnit = Database["public"]["Tables"]["vendor_units"]["Row"];
export type VendorUnitPreview =
  Database["public"]["Views"]["vendor_unit_previews"]["Row"];
export type VendorLocationSession =
  Database["public"]["Tables"]["vendor_location_sessions"]["Row"];
export type VendorLocationSessionPreview =
  Database["public"]["Views"]["vendor_location_session_previews"]["Row"];
export type NearbyLiveVendor =
  Database["public"]["Functions"]["nearby_live_vendors"]["Returns"][number];
export type LoyaltyProgram =
  Database["public"]["Tables"]["loyalty_programs"]["Row"];
export type LoyaltyProgramVersion =
  Database["public"]["Tables"]["loyalty_program_versions"]["Row"];
export type LoyaltyAccount =
  Database["public"]["Tables"]["loyalty_accounts"]["Row"];
export type LoyaltyLedgerEntry =
  Database["public"]["Tables"]["loyalty_ledger_entries"]["Row"];
export type LoyaltyRedemption =
  Database["public"]["Tables"]["loyalty_redemptions"]["Row"];
export type LoyaltyProgramPreview =
  Database["public"]["Views"]["loyalty_program_previews"]["Row"];
export type LoyaltyRewardCatalogItem =
  Database["public"]["Tables"]["loyalty_reward_catalog_items"]["Row"];
