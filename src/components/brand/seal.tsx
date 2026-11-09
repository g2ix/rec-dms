import Image from "next/image";

export function Seal({
  size,
  alt = "University of San Carlos seal",
  priority = false,
}: {
  size: 24 | 32 | 36 | 80 | 96;
  alt?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src="/brand/usc-seal-512.png"
      alt={alt}
      width={size}
      height={size}
      priority={priority || size === 96}
    />
  );
}
