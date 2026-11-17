// Small inline SVG icon set — no emoji, no traced assets from the original.
// Simple geometric strokes, consistent 1.5px stroke weight, 20x20 viewBox.
import { SVGProps } from "react";

function Base(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export function LockIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <rect x="4.5" y="9" width="11" height="7.5" rx="1.5" />
      <path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9" />
    </Base>
  );
}

export function CopyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <rect x="7.5" y="7.5" width="9.5" height="9.5" rx="1.5" />
      <path d="M4.5 12.5V5.5a2 2 0 0 1 2-2h7" />
    </Base>
  );
}

export function BellIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M5 8a5 5 0 0 1 10 0c0 4 1.5 5 1.5 5h-13S5 12 5 8Z" />
      <path d="M8.5 16a1.5 1.5 0 0 0 3 0" />
    </Base>
  );
}

export function ChevronDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M5 7.5 10 13l5-5.5" />
    </Base>
  );
}

export function NetworkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <circle cx="10" cy="4" r="1.75" />
      <circle cx="4.5" cy="15" r="1.75" />
      <circle cx="15.5" cy="15" r="1.75" />
      <path d="M10 5.75v3.5M8.7 10.4 5.7 13.3M11.3 10.4l3 2.9" />
    </Base>
  );
}

export function FilterIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M4 5h12M6.5 10h7M9 15h2" />
    </Base>
  );
}

export function EyeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z" />
      <circle cx="10" cy="10" r="2.2" />
    </Base>
  );
}

export function EyeOffIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z" />
      <path d="M3.5 3.5l13 13" />
    </Base>
  );
}

export function CrownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M4 15.5h12l-1-7.5-3 3-2-5-2 5-3-3-1 7.5Z" />
    </Base>
  );
}

export function BookmarkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M5.5 3.5h9a1 1 0 0 1 1 1V17l-5.5-3.5L4.5 17V4.5a1 1 0 0 1 1-1Z" />
    </Base>
  );
}
