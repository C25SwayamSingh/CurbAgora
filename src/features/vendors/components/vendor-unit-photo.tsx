import Image from "next/image";

import { InitialsAvatar } from "@/components/app/initials-avatar";
import { cn } from "@/lib/utils";
import { vendorPhotoPublicUrl } from "@/features/vendors/photo";

/**
 * The unit's business photo when one exists, otherwise the same initials
 * avatar as before photos existed. Pass sizing via className (e.g.
 * "size-10"); the photo renders as a rounded rectangle, the fallback stays
 * a circle.
 */
export function VendorUnitPhoto({
  path,
  displayName,
  className,
  sizes,
}: {
  path: string | null;
  displayName: string;
  className?: string;
  /** next/image responsive sizes hint; defaults to a small thumbnail. */
  sizes?: string;
}) {
  const url = vendorPhotoPublicUrl(path);

  if (!url) {
    return <InitialsAvatar displayName={displayName} className={className} />;
  }

  return (
    <span
      className={cn(
        "relative inline-block shrink-0 overflow-hidden rounded-lg",
        className,
      )}
    >
      <Image
        src={url}
        alt={`${displayName} business photo`}
        fill
        sizes={sizes ?? "80px"}
        className="object-cover"
      />
    </span>
  );
}
