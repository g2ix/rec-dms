import Image from "next/image";

export function Seal({ size }: { size: 32 | 96 }) {
  return (
    <Image
      src="/brand/usc-seal-512.png"
      alt="University of San Carlos seal"
      width={size}
      height={size}
      priority={size === 96}
    />
  );
}
