import type { SubrequestBudget } from "./fetch-with-retry";

// Etsy requests one invocation may send: Workers Free's 50 subrequests, less room for
// the token refresh and a photo download.
export const ETSY_SUBREQUESTS = 45;

// A fresh budget for one invocation.
export function etsySubrequestBudget(limit: number = ETSY_SUBREQUESTS): SubrequestBudget {
  let remaining = limit;
  return {
    take: () => {
      if (remaining <= 0) {
        return false;
      }
      remaining -= 1;
      return true;
    },
  };
}
