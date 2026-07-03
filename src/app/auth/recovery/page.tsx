import { Suspense } from "react";

import { AuthRecoveryInterstitial } from "@/features/authentication/components/auth-recovery-interstitial";

export const metadata = { title: "Continue password reset — CurbAgora" };

export default function AuthRecoveryPage() {
  return (
    <Suspense fallback={null}>
      <AuthRecoveryInterstitial />
    </Suspense>
  );
}
