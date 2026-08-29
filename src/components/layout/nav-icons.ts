import {
  Chart,
  Disc,
  Download,
  Heart,
  Home,
  Library,
  Mic,
  Radio,
  Search,
  Settings,
  Sparkle,
  StaticClock,
  Upload,
  Users,
} from '@/components/icons';
import type { SidebarItemId } from '@/lib/sidebar';

/**
 * One glyph per destination.
 *
 * Its own module because both the top bar and anything else that lists
 * destinations needs it, and a constant living in a component file costs that
 * file its fast refresh — the lint rule is right: a shared table is not a
 * component.
 */
export const NAV_ICONS: Record<SidebarItemId, typeof Home> = {
  home: Home,
  search: Search,
  library: Library,
  liked: Heart,
  history: StaticClock,
  downloads: Download,
  podcasts: Mic,
  radio: Radio,
  statistics: Chart,
  smart: Sparkle,
  browse: Disc,
  feed: Users,
  uploads: Upload,
  settings: Settings,
};
