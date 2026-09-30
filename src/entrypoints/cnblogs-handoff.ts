import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { installCnblogsHandoff } from "../platforms/cnblogs-handoff";

export default defineUnlistedScript(() => {
  installCnblogsHandoff();
});
