import { SiteChrome } from "@ros/web-core/features/site/site-chrome";

export default function PublicLayout({ children }: LayoutProps<"/">) {
  return <SiteChrome>{children}</SiteChrome>;
}
