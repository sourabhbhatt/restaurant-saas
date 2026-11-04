import { announcementInputSchema } from "@/contracts/platform";
import { platformService } from "@/server/composition/platform";
import { route } from "@/server/http/route";

export const GET = route({ auth: "platform" }, async ({ actor, c }) => ({
  data: await platformService(c).listAnnouncements(actor),
}));

export const POST = route(
  { auth: "platform", body: announcementInputSchema },
  async ({ actor, body, meta, c }) => ({
    status: 201,
    data: await platformService(c).createAnnouncement(actor, body, meta),
  }),
);
