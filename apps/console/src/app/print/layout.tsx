import { StaffOffline } from "@ros/web-core/staff-offline";

/** Print pages are staff screens: same offline layer as the signed-in area. */
export default function PrintLayout({ children }: LayoutProps<"/print">) {
  return (
    <>
      <StaffOffline />
      {children}
    </>
  );
}
