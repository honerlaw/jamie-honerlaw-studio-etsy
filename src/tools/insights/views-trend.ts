// Daily views snapshots: lifetime views per listing id, keyed by UTC day.
export type Snapshot = Readonly<Record<string, number>>;

export interface ViewsTrend {
  readonly days: readonly { readonly day: string; readonly total_views: number; readonly new_views: number | null }[];
  readonly top_listings: readonly { readonly listing_id: number; readonly new_views: number }[];
}

// Turns consecutive snapshots into daily new views (shop-wide) and the listings that
// gained the most views across the range. A day without a snapshot is skipped; the
// first day has no "new views" because there's nothing before it to compare with.
// A listing that disappears (sold out, deactivated) doesn't count as negative views.
export function viewsTrend(snapshots: readonly { readonly day: string; readonly views: Snapshot }[]): ViewsTrend {
  const days = snapshots.map((snapshot, index) => {
    const total = Object.values(snapshot.views).reduce((sum, views) => sum + views, 0);
    const previous = snapshots[index - 1];
    if (previous === undefined) {
      return { day: snapshot.day, total_views: total, new_views: null };
    }
    const gained = Object.entries(snapshot.views).reduce(
      (sum, [id, views]) => sum + Math.max(0, views - (previous.views[id] ?? views)),
      0,
    );
    return { day: snapshot.day, total_views: total, new_views: gained };
  });
  const first = snapshots[0]?.views ?? {};
  const last = snapshots.at(-1)?.views ?? {};
  const top = Object.entries(last)
    .map(([id, views]) => ({ listing_id: Number(id), new_views: Math.max(0, views - (first[id] ?? views)) }))
    .filter((listing) => listing.new_views > 0)
    .sort((a, b) => b.new_views - a.new_views)
    .slice(0, 10);
  return { days, top_listings: top };
}
