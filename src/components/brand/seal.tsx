import Image from "next/image";

type MarkSize = 24 | 32 | 36 | 80 | 96;

export function Seal({
  size,
  alt = "University of San Carlos seal",
  priority = false,
  className,
}: {
  size: MarkSize;
  alt?: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <Image
      src="/brand/usc-seal-512.png"
      alt={alt}
      width={size}
      height={size}
      priority={priority || size === 96}
      className={className}
    />
  );
}

export function RecLogo({
  size,
  alt = "USC Research Ethics Committee logo",
  priority = false,
  className,
}: {
  size: MarkSize;
  alt?: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <Image
      src="/brand/rec-logo-512.png"
      alt={alt}
      width={size}
      height={size}
      priority={priority || size === 96}
      className={className}
    />
  );
}

/**
 * The REC logo (main mark) beside the USC seal. When `sealClassName` is set the
 * seal can be hidden separately, e.g. in the collapsed sidebar rail.
 */
export function BrandMarks({
  size,
  priority = false,
  decorative = false,
  className,
  sealClassName,
}: {
  size: MarkSize;
  priority?: boolean;
  decorative?: boolean;
  className?: string;
  sealClassName?: string;
}) {
  return (
    <span className={className ? `rec-marks ${className}` : "rec-marks"}>
      <RecLogo size={size} priority={priority} alt={decorative ? "" : undefined} />
      <Seal size={size} priority={priority} alt={decorative ? "" : undefined} className={sealClassName} />
    </span>
  );
}
