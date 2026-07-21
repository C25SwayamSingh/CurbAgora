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
  | "PURCHASE_STAMP"
  | "FIRST_VISIT_BONUS"
  | "REDEMPTION"
  | "REVERSAL"
  | "MANUAL_ADJUSTMENT";
export type LoyaltyProgramVersionStatus = "active" | "archived";
export type LoyaltyClaimStatus =
  "pending" | "confirmed" | "cancelled" | "expired";
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
          stamps_required: number;
          qualifying_min_cents: number;
          stamp_period_minutes: number;
          reward_name: string;
          reward_retail_value_cents: number;
          reward_est_cost_cents: number | null;
          advisor_snapshot: Json | null;
          created_by: string;
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
          stamp_balance: number;
          lifetime_stamps: number;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      loyalty_claim_codes: {
        Row: {
          id: string;
          account_id: string;
          organization_id: string;
          code: string;
          status: LoyaltyClaimStatus;
          expires_at: string;
          confirmed_by: string | null;
          confirmed_at: string | null;
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
          stamps_spent: number;
          reward_name: string;
          expires_at: string;
          confirmed_by: string | null;
          confirmed_at: string | null;
          created_at: string;
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
          delta_stamps: number;
          reason: string | null;
          idempotency_key: string;
          reverses_entry_id: string | null;
          claim_code_id: string | null;
          redemption_id: string | null;
          actor_user_id: string;
          created_at: string;
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
          stamps_required: number;
          qualifying_min_cents: number;
          stamp_period_minutes: number;
          reward_name: string;
          reward_retail_value_cents: number;
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
          p_stamps_required: number;
          p_qualifying_min_cents: number;
          p_stamp_period_minutes: number;
          p_reward_name: string;
          p_reward_retail_value_cents: number;
          p_reward_est_cost_cents?: number | null;
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
      loyalty_create_claim_code: {
        Args: { p_organization_id: string };
        Returns: { code: string; expires_at: string }[];
      };
      loyalty_confirm_claim: {
        Args: { p_organization_id: string; p_code: string };
        Returns: {
          stamp_balance: number;
          stamps_required: number;
          first_visit: boolean;
        }[];
      };
      loyalty_request_redemption: {
        Args: { p_organization_id: string };
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
        Args: { p_account_id: string; p_delta: number; p_reason: string };
        Returns: undefined;
      };
      loyalty_program_stats: {
        Args: { p_organization_id: string };
        Returns: {
          members: number;
          stamps_issued: number;
          rewards_redeemed: number;
          outstanding_stamps: number;
          estimated_liability_cents: number;
        }[];
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
