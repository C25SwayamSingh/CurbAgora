/**
 * Database types for the Phase 2 auth/tenancy schema.
 *
 * Maintained by hand to mirror
 * `supabase/migrations/20260701000000_auth_tenancy_foundation.sql`.
 * When a local Supabase stack is available, regenerate with:
 *
 *   supabase gen types typescript --local > src/lib/supabase/database.types.ts
 *
 * and re-apply the helper aliases at the bottom if they are lost.
 */

export type AccountType = "customer" | "vendor";
export type OnboardingStatus = "not_started" | "in_progress" | "complete";
export type OrganizationStatus = "active" | "suspended" | "archived";
export type OrganizationRole = "owner" | "manager" | "staff";
export type MembershipStatus = "invited" | "active" | "revoked";

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
          account_type: AccountType | null;
          onboarding_status: OnboardingStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name?: string;
          avatar_url?: string | null;
          account_type?: AccountType | null;
          onboarding_status?: OnboardingStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string;
          avatar_url?: string | null;
          account_type?: AccountType | null;
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
    };
    Views: Record<string, never>;
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
    };
    Enums: {
      account_type: AccountType;
      onboarding_status: OnboardingStatus;
      organization_status: OrganizationStatus;
      organization_role: OrganizationRole;
      membership_status: MembershipStatus;
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
