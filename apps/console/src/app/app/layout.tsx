import { StaffOffline } from "@ros/web-core/staff-offline";

/**
 * The signed-in area works offline: the service worker and the offline runtime
 * start here, never on public, sign-in or guest pages.
 */
export default function SignedInAreaLayout({ children }: LayoutProps<"/app">) {
  return (
    <>
      <StaffOffline />
      {children}
    </>
  );
}
