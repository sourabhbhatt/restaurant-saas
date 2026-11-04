import { SiteChrome } from "@/features/site/site-chrome";

export default function PublicLayout({ children }: LayoutProps<"/">) {
  return <SiteChrome>{children}</SiteChrome>;
}
