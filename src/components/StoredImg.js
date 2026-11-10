"use client";

import { fileUrlNow, useFileUrls } from "@/lib/fileUrls";

// An <img> of a stored file (a picture, a preview, a homework page): files
// open through short-lived links (src/lib/fileUrls.js), so the picture
// appears once its link has arrived. Anything else shows as it is.
export default function StoredImg({ src, alt = "", ref, ...rest }) {
  const version = useFileUrls();
  const real = fileUrlNow(src, version);
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} src={real || undefined} alt={alt} {...rest} />;
}
